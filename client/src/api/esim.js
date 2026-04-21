// client/src/api/esim.js

export async function getCsrf() {
  // Sets CSRF cookie
  await fetch('/auth/csrf', { credentials: 'include' });
  return undefined;
}

/**
 * Reserve (create) a new eSIM profile
 */
export async function reserveEsim(region = 'US') {
  await getCsrf();

  const res = await fetch('/esim/profiles', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ region }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to reserve eSIM: ${text}`);
  }

  return res.json();
  // returns:
  // {
  //   providerProfileId,
  //   iccid,
  //   iccidHint,
  //   smdp,
  //   activationCode,
  //   lpaUri,
  //   qrPayload,
  //   region
  // }
}

/**
 * 🔥 NEW: Get current user's saved eSIM (QR + activation data)
 */
export async function getMyEsim() {
  const res = await fetch('/esim/me', {
    method: 'GET',
    credentials: 'include',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch eSIM: ${text}`);
  }

  return res.json();
  // returns:
  // { subscriber: {...} | null }
}

/**
 * Activate eSIM profile
 */
export async function activateEsim({ iccid, activationCode, providerProfileId }) {
  await getCsrf();

  const res = await fetch('/esim/activate', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      iccid,
      code: activationCode,
      providerProfileId,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to activate eSIM: ${text}`);
  }

  return res.json();
}

/**
 * Suspend eSIM line
 */
export async function suspendEsim({ iccid, providerProfileId }) {
  await getCsrf();

  const res = await fetch('/esim/suspend', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ iccid, providerProfileId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to suspend eSIM: ${text}`);
  }

  return res.json();
}

/**
 * Resume eSIM line
 */
export async function resumeEsim({ iccid, providerProfileId }) {
  await getCsrf();

  const res = await fetch('/esim/resume', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ iccid, providerProfileId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to resume eSIM: ${text}`);
  }

  return res.json();
}