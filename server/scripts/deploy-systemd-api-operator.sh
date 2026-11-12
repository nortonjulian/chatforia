#!/usr/bin/env bash
# Run only from the existing firewall-allowed operator source after separate
# production deployment approval. The receipt must come from a successful,
# protected Verify Chatforia Backend Operator Handoff workflow run.
set -euo pipefail

if (( $# != 5 )); then
  echo 'Usage: deploy-systemd-api-operator.sh HANDOFF_JSON PACKAGE_JSON CHECKOUT SSH_HOST SSH_KEY' >&2
  exit 2
fi
receipt=$1
package=$2
checkout=$3
host=$4
key=$5
known_hosts=${API_DO_OPERATOR_KNOWN_HOSTS:?Set API_DO_OPERATOR_KNOWN_HOSTS to the existing pinned file}

[[ -f "$receipt" && -f "$package" && -f "$key" && -s "$known_hosts" ]]
test "$(git -C "$checkout" rev-parse --is-inside-work-tree)" = true
[[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]

read -r commit package_sha256 run_id run_attempt < <(node -e '
  const fs = require("node:fs");
  const r = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (r.version !== 1 || r.repository !== "nortonjulian/chatforia" ||
      r.workflow !== "deploy-backend.yml" || r.ref !== "refs/heads/main" ||
      !/^[0-9a-f]{40}$/.test(r.commit) || !/^[0-9a-f]{64}$/.test(r.package_sha256) ||
      !Number.isSafeInteger(r.run_id) || r.run_id < 1 ||
      !Number.isSafeInteger(r.run_attempt) || r.run_attempt < 1) process.exit(1);
  console.log(r.commit, r.package_sha256, r.run_id, r.run_attempt);
' "$receipt")

actual_sha256=$(shasum -a 256 "$package")
test "${actual_sha256%% *}" = "$package_sha256"
git -C "$checkout" fetch --no-tags origin main
test "$(git -C "$checkout" rev-parse origin/main)" = "$commit"
test "$(git -C "$checkout" rev-parse HEAD)" = "$commit"
test -z "$(git -C "$checkout" status --porcelain --untracked-files=no)"
cmp -s "$0" <(git -C "$checkout" show "$commit:server/scripts/deploy-systemd-api-operator.sh")

echo "Ready to stream reviewed commit $commit and package $package_sha256 from handoff run $run_id attempt $run_attempt" >&2
cd "$checkout"
git show "$commit:server/scripts/deploy-systemd-api.sh" |
  ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes \
    -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$known_hosts" \
    "root@$host" bash -se -- "$commit" "$package_sha256"
