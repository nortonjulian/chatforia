import { createMfaChallenge } from './mfaLogin.js';

export function pendingCookieOptions(req) {
  const secure = process.env.NODE_ENV === 'production' || Boolean(req.secure);
  return { path: '/', secure, httpOnly: true, sameSite: secure ? 'none' : 'lax' };
}
export function pendingCookieName(req) {
  return `${pendingCookieOptions(req).secure ? '__Host-' : ''}cf_mfa_pending`;
}
export async function startWebMfa(req, res, user, nextUrl) {
  const token = await createMfaChallenge(user, nextUrl);
  res.set('Cache-Control', 'no-store');
  res.cookie(pendingCookieName(req), token, { ...pendingCookieOptions(req), maxAge: 5 * 60 * 1000 });
  return res.redirect('/auth/2fa/challenge');
}
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
export function renderMfaPage(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/auth/2fa/challenge.css">
<meta name="referrer" content="no-referrer"><title>Chatforia verification</title>
<script src="/auth/2fa/challenge.js" defer></script></head><body><main>
<h1>Verify your Chatforia sign-in</h1>
<p>Enter your authenticator code or an unused backup code.</p>
<form id="mfa-form"><input type="hidden" id="mfa-token" value="${escape(token)}">
<label for="mfa-code">Verification code</label>
<input id="mfa-code" name="code" autocomplete="one-time-code" maxlength="64" required autofocus>
<button type="submit">Verify and continue</button>
<p id="mfa-error" role="alert"></p></form>
<p>If your sign-in has expired, return to Chatforia and start again.</p>
</main></body></html>`;
}
// External same-origin script works with the API's existing script-src 'self' CSP.
export const MFA_BROWSER_SCRIPT = `
document.getElementById('mfa-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const error = document.getElementById('mfa-error');
  button.disabled = true;
  error.textContent = '';
  try {
    const csrfResponse = await fetch('/auth/csrf', { credentials: 'include' });
    if (!csrfResponse.ok) throw new Error('Verification unavailable. Try again.');
    const csrf = await csrfResponse.json();
    const cookie = document.cookie.match(/(?:^|;\\s*)XSRF-TOKEN=([^;]+)/);
    const csrfToken = csrf.csrfToken || (cookie ? decodeURIComponent(cookie[1]) : '');
    const response = await fetch('/auth/2fa/login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
        ...(csrfToken ? { 'X-XSRF-TOKEN': csrfToken } : {}) },
      body: JSON.stringify({ browserMfa: true,
        mfaToken: document.getElementById('mfa-token').value,
        code: document.getElementById('mfa-code').value.trim() }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || !data.redirectUrl) {
      throw new Error(data.error || 'Verification failed. Start sign-in again.');
    }
    window.location.replace(data.redirectUrl);
  } catch (failure) { error.textContent = failure.message || 'Verification failed.'; }
  finally { button.disabled = false; }
});
`;

export const MFA_BROWSER_CSS = `
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f9; color: #222; font: 16px/1.5 system-ui, sans-serif; }
main { box-sizing: border-box; width: min(92vw, 440px); padding: 28px; background: white; border: 1px solid #ddd; border-radius: 20px; }
h1 { font-size: 24px; line-height: 1.3; }
label, input, button { display: block; box-sizing: border-box; width: 100%; }
input { padding: 12px; margin: 8px 0 16px; font: inherit; border: 1px solid #888; border-radius: 8px; }
button { padding: 12px; font: inherit; font-weight: 600; border: 0; border-radius: 8px; background: #ffb844; color: #111; cursor: pointer; }
button:disabled { opacity: .6; cursor: wait; }
#mfa-error { color: #b42318; }
@media (prefers-color-scheme: dark) { body { background: #141414; color: #eee; } main { background: #222; border-color: #444; } input { background: #151515; color: #eee; } #mfa-error { color: #ff938e; } }
`;
