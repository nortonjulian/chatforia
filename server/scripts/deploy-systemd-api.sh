#!/usr/bin/env bash
set -euo pipefail
umask 027

commit=${1:?full release commit required}
package_sha256=${2:?package digest required}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$package_sha256" =~ ^[0-9a-f]{64}$ ]] || exit 1

checkout=/var/www/chatforia-api
unit=chatforia-api.service
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(systemctl show -P Group "$unit")" = chatforia-api
test "$(systemctl show -P WorkingDirectory "$unit")" = "$checkout/server"
[[ "$(systemctl show -P ExecStart "$unit")" == *"/usr/bin/node $checkout/server/bootstrap.js"* ]]
[[ "$(systemctl show -P EnvironmentFiles "$unit")" == *"/etc/chatforia/api-runtime.env"* ]]
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
test "$(sha256sum "$stage/package.json" | cut -d' ' -f1)" = "$package_sha256"
chgrp chatforia-api "$stage/package.json"
chmod 640 "$stage/package.json"

# The same restricted EnvironmentFile and OS identity used by the API must
# confirm the 164-file schema, grants, and existing staff boundary before stop.
systemd-run --unit=chatforia-application-release-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$stage/source/server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  /usr/bin/node "$stage/source/server/scripts/application-release-preflight.mjs" \
  runtime "$stage/package.json" "$package_sha256"
systemd-run --unit=chatforia-staff-runtime-check --wait --collect --pipe \
  -p User=chatforia-api -p Group=chatforia-api \
  -p WorkingDirectory="$stage/source/server" \
  -p EnvironmentFile=/etc/chatforia/api-runtime.env \
  /usr/bin/node "$stage/source/server/scripts/staff-deployment-preflight.mjs" --runtime

# A failure after stop leaves the service stopped for operator recovery; never
# revive PM2 or run an unreviewed migration/automatic downgrade.
systemctl stop "$unit"
git switch --detach "$commit"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
npx prisma generate --schema=server/prisma/schema.prisma
systemctl start "$unit"
systemctl is-active --quiet "$unit"
test "$(systemctl show -P User "$unit")" = chatforia-api
test "$(git rev-parse HEAD)" = "$commit"
