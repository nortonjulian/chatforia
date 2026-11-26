# Frontend deployment workflow — local PR draft and release procedure

Prepared November 25, 2026. This is a local review artifact. No workflow was dispatched and no deployment or production configuration change was made.

## Proposed separate PR

**Title:** Pin frontend deploy SSH identity and verify exact release artifact

- **Base:** `origin/main` at `d189cf65b213c307f4fc4b3a84709f97c08e13a9`
- **Branch:** `release/web-deploy-hardening-review-20261125`

**Description:** Harden the existing `.github/workflows/deploy.yml` rather than creating another deployment path. The `verify_ssh` mode remains the default and uses the already recorded ed25519 fingerprint. `deploy` is limited to `main`, requires an exact reviewed 40-character SHA matching the dispatched commit and checkout, installs root workspace dependencies from the lockfile with `npm ci --ignore-scripts --no-audit --no-fund`, builds `client/dist`, and computes its SHA-256 file-manifest hash. The same hash is checked on the web host after `rsync` and before nginx reload. All SSH and rsync calls require the pinned host key and public-key authentication. The website source candidate remains a separate PR.

**Changed production path:** `.github/workflows/deploy.yml` only. This branch also carries this review/runbook document. No website code, locale catalog, backend, native, MLS, Random Chat, Wireless, or protected-username implementation is transferred from the earlier release-slice worktree.

### Review evidence

- Refreshed `origin/main` remains `d189cf65`. The prepared workflow diff from the earlier release-slice worktree applied cleanly to a new worktree from that revision; both diffs have SHA-256 `c2cd5d8ecc1e6e933436b4d6feacceb6e1297fd3d203892af354db05804eebb6`.
- `git diff --check` passed. Ruby/Psych parsed the YAML; all seven `run` steps passed `bash -n`. No `actionlint` binary was available locally, and GitHub Actions has not run this branch.
- Static assertions passed for default verify mode, main-only deploy, SHA equality, fingerprint comparison in both modes, locked install with no `npm install`, strict host-key options on SSH/rsync, matching local/remote artifact hashes, and preservation of `env.js`.
- The deployment job does not run server Prisma generation. Previous website work installed locked dependencies with the same root `npm ci --ignore-scripts` form and passed the client production build; no unchanged build was repeated solely for this workflow review.

### Limits requiring release-operator review

- The artifact hash deliberately excludes `env.js`, which `rsync` preserves. Confirm its presence and approved runtime API/Socket origin before release. Do not infer this from the artifact hash.
- Confirm the `DO_HOST` secret still identifies the active web server whose nginx document root is `/var/www/chatforia`, and that `www.chatforia.com` and `chatforia.com` actually serve that host through the current edge configuration. A successful SSH connection alone does not establish the public serving path.
- The exact deployable artifact cannot be named until **both** approved PRs are merged and the final reviewed main SHA is known. If main advances between review and dispatch, the SHA equality gate must fail and the release must be reviewed again.
- This review does not authorize deploying current main, changing `env.js`, purging a CDN cache, or performing provider transactions.

## Exact post-merge verification procedure — for later separate approval

Run from a clean checkout after both PRs are merged. The following commands are **prepared, not executed**. Record the final reviewed SHA, GitHub run ID, artifact hash, and pass/fail statuses without saving credentials, cookies, tokens, customer data, or private media.

1. Refresh and record the exact reviewed main revision. Confirm no later main commit before dispatch:

   ```bash
   git fetch origin main
   RELEASE_SHA="$(git rev-parse origin/main)"
   printf 'reviewed main SHA: %s\n' "$RELEASE_SHA"
   git log -1 --format='%H %s' origin/main
   ```

2. Run the existing `verify_ssh` mode. Confirm the workflow's pinned-fingerprint and SSH steps pass. After separate deployment approval, dispatch `deploy` with **the same** reviewed SHA; the job refuses a different `GITHUB_SHA` or checkout:

   ```bash
   gh workflow run deploy.yml --ref main -f mode=verify_ssh
   # Only after separate owner deployment approval:
   gh workflow run deploy.yml --ref main -f mode=deploy -f expected_sha="$RELEASE_SHA"
   ```

3. In the approved GitHub Actions run, require the revision check, locked install, build, SSH pin, `rsync`, and remote-hash comparison to pass. Record the `Release <SHA> artifact SHA-256: <digest>` line from the job summary and the final `Verified deployed artifact` line. The workflow compares sorted SHA-256 sums of every regular file in `client/dist`, excluding `env.js`, with the corresponding files in `/var/www/chatforia` **before nginx reload**. Do not substitute a separately rebuilt artifact or a branch-head hash.

4. In the owner-controlled web-host console, make these **read-only** checks. They print status and checksums, not runtime file contents. Compare `artifact_sha256` to the GitHub job summary. Use the approved console/SSH identity; do not retrieve workflow secrets:

   ```bash
   cd /var/www/chatforia
   test -s index.html && test -s qr-chatforia.png && test -s env.js
   find . -type f ! -name env.js -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
   sha256sum index.html qr-chatforia.png env.js
   grep -Fq 'window.__API_URL__ = "https://api.chatforia.com";' env.js
   if grep -q '__WS_URL__' env.js; then grep -Fq 'wss://api.chatforia.com' env.js; fi
   if grep -Eiq 'localhost|127[.]0[.]0[.]1' env.js; then exit 1; fi
   ```

   The `env.js` check matches the current approved runtime API origin. If an authorized configuration change has altered that contract, stop and review the actual approved origin before adapting the check. The app derives `wss://api.chatforia.com` from the API origin when `__WS_URL__` is absent.

5. Verify the **public serving path** after the deployment job succeeds. In a read-only host-console session, fetch uncached public files and compare them with the installed files. A mismatch means the host, edge cache, or release path has not been established; do not record deployment as verified:

   ```bash
   set -euo pipefail
   RELEASE_SHA='<the same reviewed 40-character main SHA>'
   cmp /var/www/chatforia/index.html <(curl -fsSL -H 'Cache-Control: no-cache' \
     -H 'Accept-Encoding: identity' "https://www.chatforia.com/index.html?release=$RELEASE_SHA")
   cmp /var/www/chatforia/qr-chatforia.png <(curl -fsSL -H 'Cache-Control: no-cache' \
     -H 'Accept-Encoding: identity' "https://www.chatforia.com/qr-chatforia.png?release=$RELEASE_SHA")
   cmp /var/www/chatforia/env.js <(curl -fsSL -H 'Cache-Control: no-cache' \
     -H 'Accept-Encoding: identity' "https://www.chatforia.com/env.js?release=$RELEASE_SHA")
   curl -fsSLI "https://chatforia.com/?release=$RELEASE_SHA"
   ```

   Also compare the main JS asset referenced by `index.html` if the edge rewrites HTML or the primary asset path is separately cached. A 200 response alone is insufficient. Confirm the documented apex-to-www redirect and trusted TLS certificate. Keep live API reads limited to `/health` and separately approved disposable-account checks; do not repeat the verified production migration ledger.

## Release decision

**GO for separate PR review; NO-GO for deployment until this workflow is merged, its GitHub checks pass, the exact final main artifact and public serving host are verified, and the website PR's remaining owner/accessibility decisions are recorded.** Live carrier delivery, Telna purchases/replacement, physical-device behavior, account/encryption-key invalidation, and Velvet's approved white-on-gold contrast exception are not established by this infrastructure PR.
