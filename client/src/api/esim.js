export async function getCsrf() {
  // Sets CSRF cookie; if you expose the token value, you can return/use it.
  await fetch('/auth/csrf', { credentials: 'include' });
  return undefined;
}

export async function reserveEsim(region = 'US') {
  await getCsrf();
  const res = await fetch('/esim/profiles', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // 'X-CSRF-Token': token, // if you return it from /auth/csrf
    },
    body: JSON.stringify({ region }),
  });
  if (!res.ok) throw new Error('Failed to reserve eSIM');
  return res.json(); // { smdp, activationCode, lpaUri, qrPayload, iccidHint }
}
