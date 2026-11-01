import axiosClient from './axiosClient';

export async function setupTwoFactor() {
  const { data } = await axiosClient.post('/auth/2fa/setup');

  if (!data?.ok || !data?.tmpSecret || !data?.qrDataUrl) {
    throw new Error('Could not start two-factor authentication setup.');
  }

  return {
    tmpSecret: data.tmpSecret,
    qrDataUrl: data.qrDataUrl,
  };
}

export async function enableTwoFactor(tmpSecret, code) {
  if (!tmpSecret || !/^\d{6}$/.test(String(code))) {
    throw new Error('Enter a valid six-digit authenticator code.');
  }

  const { data } = await axiosClient.post('/auth/2fa/enable', {
    tmpSecret,
    code: String(code),
  });

  if (data?.ok === false) {
    throw new Error('Could not enable two-factor authentication.');
  }

  if (
    data?.ok !== true ||
    !Array.isArray(data.backupCodes) ||
    data.backupCodes.length === 0 ||
    !data.backupCodes.every(
      (value) => typeof value === 'string' && value.length > 0
    )
  ) {
    throw new Error(
      'Two-factor authentication response was incomplete. ' +
      'Check your account security status before retrying.'
    );
  }

  // The server rotates the HttpOnly session cookie.
  // Do not persist the returned JWT in browser storage.
  return {
    backupCodes: data.backupCodes,
  };
}

export async function disableTwoFactor(code) {
  if (!/^\d{6}$/.test(String(code))) {
    throw new Error('Enter a valid six-digit authenticator code.');
  }

  const { data } = await axiosClient.post('/auth/2fa/disable', {
    code: String(code),
  });

  if (!data?.ok) {
    throw new Error('Could not disable two-factor authentication.');
  }

  return true;
}
