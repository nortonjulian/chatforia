#!/usr/bin/env bash
set -euo pipefail
umask 027

commit=${1:?full release commit required}
package_sha256=${2:?package digest required}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$package_sha256" =~ ^[0-9a-f]{64}$ ]] || exit 1
test "$(id -u)" -eq 0

checkout=/var/www/chatforia-api
unit=chatforia-api.service
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(systemctl show -P Group "$unit")" = chatforia-api
test "$(systemctl show -P WorkingDirectory "$unit")" = "$checkout/server"
[[ "$(systemctl show -P ExecStart "$unit")" == *"/usr/bin/node $checkout/server/bootstrap.js"* ]]
[[ "$(systemctl show -P EnvironmentFiles "$unit")" == *"/etc/chatforia/api-runtime.env"* ]]
[[ "$(systemctl show -P Environment "$unit")" == *"NODE_ENV=production"* ]]
[[ "$(systemctl show -P Environment "$unit")" == *"DOTENV_CONFIG_PATH=/dev/null"* ]]
if grep -Eq '^[[:space:]]*DOTENV_CONFIG_(PATH|OVERRIDE)[[:space:]]*=' /etc/chatforia/api-runtime.env; then
  echo 'Runtime EnvironmentFile overrides dotenv isolation' >&2
  exit 1
fi
systemctl is-active --quiet "$unit"

cd "$checkout"
test -z "$(git status --porcelain --untracked-files=no)"
git fetch --no-tags origin main
git merge-base --is-ancestor "$commit" origin/main
test -z "$(git diff --name-only HEAD "$commit" -- server/uploads/)"

stage=$(mktemp -d /var/tmp/chatforia-api-release.XXXXXX)
chgrp chatforia-api "$stage"
chmod 750 "$stage"
cleanup() {
  git worktree remove --force "$stage/source" 2>/dev/null || true
  rm -rf -- "$stage"
}
trap cleanup EXIT
git worktree add --detach "$stage/source" "$commit"
chgrp -R chatforia-api "$stage/source"
chmod -R g+rX "$stage/source"
(
  cd "$stage/source"
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
  npx prisma generate --schema=server/prisma/schema.prisma
  node server/scripts/migration-package.mjs "$commit" "$stage/package.json"
)
# npm ci and Prisma generation create files after the initial permission pass.
# The restricted preflight process must be able to read those exact staged bytes.
chgrp -R chatforia-api "$stage/source"
chmod -R g+rX "$stage/source"
test "$(sha256sum "$stage/package.json" | cut -d' ' -f1)" = "$package_sha256"
chgrp chatforia-api "$stage/package.json"
chmod 640 "$stage/package.json"

# The same restricted EnvironmentFile and OS identity used by the API must
# confirm the 164-file schema, grants, and existing staff boundary before stop.
systemd-run --unit=chatforia-application-release-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$stage/source/server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$stage/source/server/scripts/application-release-preflight.mjs" \
  runtime "$stage/package.json" "$package_sha256"
systemd-run --unit=chatforia-staff-runtime-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$stage/source/server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$stage/source/server/scripts/staff-deployment-preflight.mjs" --runtime

# A failure after stop leaves the service stopped for operator recovery; never
# revive PM2 or run an unreviewed migration/automatic downgrade.
systemctl stop "$unit"
git switch --detach "$commit"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
npx prisma generate --schema=server/prisma/schema.prisma

# Root's 027 umask creates new tracked source paths and dependencies without
# access for the restricted service group. Grant read/traverse only to tracked
# server code and installed dependencies; leave ignored env files and upload
# trees alone. Reject tracked symlinks rather than following an unknown target.
declare -A prepared_dirs=()
while IFS= read -r -d '' tracked; do
  case "$tracked" in server/uploads/*|server/tmp_uploads/*) continue ;; esac
  [[ ! -L "$tracked" && -f "$tracked" ]] || exit 1
  chgrp chatforia-api -- "$tracked"
  chmod g+r -- "$tracked"
  parent=${tracked%/*}
  while :; do
    if [[ ! ${prepared_dirs["$parent"]+present} ]]; then
      chgrp chatforia-api -- "$parent"
      chmod g+rx -- "$parent"
      prepared_dirs["$parent"]=1
    fi
    [[ "$parent" == server ]] && break
    parent=${parent%/*}
  done
done < <(git ls-files -z -- server)
chgrp -R chatforia-api "$checkout/node_modules"
chmod -R g+rX "$checkout/node_modules"

# Check the installed checkout under the real OS identity and runtime
# environment before asking systemd to open the listener again.
systemd-run --unit=chatforia-application-release-final-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$checkout/server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$checkout/server/scripts/application-release-preflight.mjs" \
  runtime "$stage/package.json" "$package_sha256"
systemd-run --unit=chatforia-staff-runtime-final-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$checkout/server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  -E NODE_ENV=production -E DOTENV_CONFIG_PATH=/dev/null \
  /usr/bin/node "$checkout/server/scripts/staff-deployment-preflight.mjs" --runtime
systemctl start "$unit"
systemctl is-active --quiet "$unit"
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(git rev-parse HEAD)" = "$commit"
