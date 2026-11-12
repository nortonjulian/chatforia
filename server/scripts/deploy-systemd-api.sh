#!/usr/bin/env bash
set -euo pipefail
umask 027

commit=${1:?full release commit required}
package_sha256=${2:?package digest required}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$package_sha256" =~ ^[0-9a-f]{64}$ ]] || exit 1
test "$(id -u)" -eq 0

checkout=/var/www/chatforia-api
releases=/var/www/chatforia-api-releases
unit=chatforia-api.service
unit_file=/etc/systemd/system/chatforia-api.service
active_server=$(systemctl show -P WorkingDirectory "$unit")
[[ "$active_server" =~ ^/var/www/chatforia-api-releases/[0-9a-f]{40}/app/server$ ]] || exit 1
[[ "$(systemctl show -P ExecStart "$unit")" == *"/usr/bin/node $active_server/bootstrap.js"* ]] || exit 1
test "$(systemctl show -P FragmentPath "$unit")" = "$unit_file"
test -z "$(systemctl show -P DropInPaths "$unit")"
test ! -L "$unit_file"
test "$(stat -c '%U:%G %a' "$unit_file")" = 'root:root 644'
test "$(stat -c '%U:%G %a' /etc/chatforia/api-runtime.env)" = 'root:root 600'
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(systemctl show -P Group "$unit")" = chatforia-api
[[ "$(systemctl show -P EnvironmentFiles "$unit")" == *"/etc/chatforia/api-runtime.env"* ]]
[[ "$(systemctl show -P Environment "$unit")" == *"NODE_ENV=production"* ]]
[[ "$(systemctl show -P Environment "$unit")" == *"DOTENV_CONFIG_PATH=/dev/null"* ]]
test "$(systemctl show -P Restart "$unit")" = on-failure
test "$(systemctl show -P NoNewPrivileges "$unit")" = yes
test "$(systemctl show -P ProtectHome "$unit")" = yes
if grep -Eq '^[[:space:]]*DOTENV_CONFIG_(PATH|OVERRIDE)[[:space:]]*=' /etc/chatforia/api-runtime.env; then
  echo 'Runtime EnvironmentFile overrides dotenv isolation' >&2
  exit 1
fi
systemctl is-active --quiet "$unit"
test -d "$releases" && test ! -L "$releases"

cd "$checkout"
test -z "$(git status --porcelain --untracked-files=no)"
git fetch --no-tags origin main
test "$(git rev-parse origin/main)" = "$commit"
test -z "$(git diff --name-only HEAD "$commit" -- server/uploads/)"

release="$releases/$commit"
new_server="$release/app/server"
test ! -e "$release" && test ! -L "$release"
mkdir -m 0755 -- "$release"
before_stop=true
cleanup() {
  if "$before_stop"; then
    git worktree remove --force "$release/app" 2>/dev/null || true
    rm -f -- "$release/package.json" "$release/previous-unit.service" "$release/next-unit.service"
    rmdir -- "$release" 2>/dev/null || true
  fi
}
trap cleanup EXIT
git worktree add --detach "$release/app" "$commit"
chgrp -R chatforia-api "$release/app"
chmod -R g+rX "$release/app"
(
  cd "$release/app"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
  npx prisma generate --schema=server/prisma/schema.prisma
  node server/scripts/migration-package.mjs "$commit" "$release/package.json"
)
# npm ci and Prisma generation create files after the initial permission pass.
# The restricted preflight process must be able to read those exact staged bytes.
chgrp -R chatforia-api "$release/app"
chmod -R g+rX "$release/app"
test "$(sha256sum "$release/package.json" | cut -d' ' -f1)" = "$package_sha256"
chgrp chatforia-api "$release/package.json"
chmod 640 "$release/package.json"

# The active c103 release links these two write roots to the persistent,
# restricted upload directories. Preserve them without copying or changing
# existing files, and reject a changed target before installing the new unit.
for name in uploads tmp_uploads; do
  target="$checkout/server/$name"
  test -d "$target" && test ! -L "$target"
  test "$(stat -c '%U:%G' "$target")" = 'chatforia-api:chatforia-api'
  test ! -e "$new_server/$name" && test ! -L "$new_server/$name"
  ln -s -- "$target" "$new_server/$name"
done

# Retain the exact prior unit for a separately approved recovery. Generate a
# candidate that changes only WorkingDirectory and ExecStart; no unit writes
# occur until after all pre-stop checks pass.
cp -- "$unit_file" "$release/previous-unit.service"
chmod 600 "$release/previous-unit.service"
/usr/bin/node "$release/app/server/scripts/systemd-release-unit.mjs" \
  "$unit_file" "$active_server" "$new_server" "$release/next-unit.service"

# The same restricted EnvironmentFile and OS identity used by the API must
# confirm the 164-file schema, grants, and existing staff boundary before stop.
systemd-run --unit=chatforia-application-release-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$new_server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$new_server/scripts/application-release-preflight.mjs" \
  runtime "$release/package.json" "$package_sha256"
systemd-run --unit=chatforia-staff-runtime-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$new_server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$new_server/scripts/staff-deployment-preflight.mjs" --runtime

# The current main tip may have changed during staging or restricted preflights.
# Do not stop a healthy service to activate a superseded commit.
git fetch --no-tags origin main
test "$(git rev-parse origin/main)" = "$commit"
cmp -s "$unit_file" "$release/previous-unit.service"

# A failure after stop leaves the service stopped for operator recovery; never
# revive PM2 or run an unreviewed migration/automatic downgrade.
before_stop=false
systemctl stop "$unit"
next_unit=$(mktemp /etc/systemd/system/.chatforia-api.service.XXXXXX)
install -o root -g root -m 0644 "$release/next-unit.service" "$next_unit"
mv -T -- "$next_unit" "$unit_file"
systemctl daemon-reload
test "$(systemctl show -P WorkingDirectory "$unit")" = "$new_server"
[[ "$(systemctl show -P ExecStart "$unit")" == *"/usr/bin/node $new_server/bootstrap.js"* ]]
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(systemctl show -P Group "$unit")" = chatforia-api
[[ "$(systemctl show -P EnvironmentFiles "$unit")" == *"/etc/chatforia/api-runtime.env"* ]]
[[ "$(systemctl show -P Environment "$unit")" == *"NODE_ENV=production"* ]]
[[ "$(systemctl show -P Environment "$unit")" == *"DOTENV_CONFIG_PATH=/dev/null"* ]]
test "$(systemctl show -P NoNewPrivileges "$unit")" = yes
test "$(systemctl show -P ProtectHome "$unit")" = yes

# Check the installed checkout under the real OS identity and runtime
# environment before asking systemd to open the listener again.
systemd-run --unit=chatforia-application-release-final-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$new_server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$new_server/scripts/application-release-preflight.mjs" \
  runtime "$release/package.json" "$package_sha256"
systemd-run --unit=chatforia-staff-runtime-final-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$new_server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$new_server/scripts/staff-deployment-preflight.mjs" --runtime
systemctl start "$unit"
systemctl is-active --quiet "$unit"
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(systemctl show -P WorkingDirectory "$unit")" = "$new_server"
test "$(git -C "$release/app" rev-parse HEAD)" = "$commit"
