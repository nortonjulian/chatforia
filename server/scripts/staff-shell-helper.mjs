import speakeasy from 'speakeasy';

// Local synthetic helper only. Never return enrollment secrets or login challenges.
export function codeSnapshot(accounts, secrets, now = Date.now()) {
  const expiresAt = (Math.floor(now / 30000) + 1) * 30000;
  return {
    serverTime: now,
    expiresAt,
    accounts: accounts
      .filter((a) => a.id !== 1)
      .map((a) => ({
        username: a.username,
        code:
          expiresAt - now > 5000
            ? speakeasy.totp({
                secret: secrets.get(a.username),
                encoding: 'base32',
                time: Math.floor(now / 1000),
              })
            : null,
      })),
  };
}
export function helperHtml(password, codesPath) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic local accounts</title></head><body>
<h1>Synthetic local accounts only</h1><p>Password for all accounts: <code>${password}</code></p>
<p>Use the code for the exact account you entered. MFA challenges expire after five minutes and are single-use. After expiry or five failed attempts, choose <b>Start over</b> on the login page and enter the password again.</p>
<p id="status" role="status">Fetching fresh codes…</p><div id="codes"></div><button id="refresh">Refresh codes</button>
<p>Codes disappear while this tab is hidden, when refresh fails, or near expiry. Return here immediately before entering a code; do not reuse an old screenshot or copied code.</p><a href="/" target="_blank" rel="noopener">Open actual application in another tab</a>
<p>Admin: qa_admin at /admin/users. Support: qa_support at /staff. Denied-access account: qa_user.</p>
<script type="module">
const endpoint = ${JSON.stringify(codesPath)};
const status = document.getElementById('status'), codes = document.getElementById('codes');
let snapshot = null, received = 0, generation = 0, rendered = '';
function clear(message) { snapshot = null; rendered = ''; codes.replaceChildren(); status.textContent = message; }
function render() {
  if (document.hidden) { clear('Return to this tab to fetch a fresh code.'); return; }
  if (!snapshot) return;
  const age = performance.now() - received;
  const left = snapshot.expiresAt - snapshot.serverTime - age;
  if (age > 3000 || left <= 5000) { clear('Waiting for a fresh code with enough time remaining…'); return; }
  const signature = JSON.stringify(snapshot.accounts);
  if (signature !== rendered) {
  rendered = signature; codes.replaceChildren();
  for (const account of snapshot.accounts) {
    const p = document.createElement('p'); p.dataset.account = account.username;
    const code = document.createElement('code'); code.textContent = account.code || 'Waiting for next code…';
    p.append(account.username + ': ', code); codes.append(p);
  }
  }
  status.textContent = 'Verified with local server just now. Codes expire in ' + Math.ceil(left / 1000) + ' seconds.';
}
async function refresh() {
  const request = ++generation;
  if (document.hidden) { clear('Return to this tab to fetch a fresh code.'); return; }
  try {
    const response = await fetch(endpoint, {cache:'no-store', signal:AbortSignal.timeout(2000)});
    if (!response.ok) throw Error('Unavailable');
    const data = await response.json();
    if (request !== generation || document.hidden) return;
    snapshot = data; received = performance.now(); render();
  } catch { if (request === generation) clear('Unable to refresh. No code is shown. Retry Refresh codes.'); }
}
document.getElementById('refresh').addEventListener('click', refresh);
document.addEventListener('visibilitychange', () => { generation++; clear('Fetching fresh codes…'); refresh(); });
window.addEventListener('focus', refresh);
setInterval(refresh, 1000); setInterval(render, 200); refresh();
</script></body></html>`;
}
