export function displayValue(key, value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean')
    return key.startsWith('show')
      ? value
        ? 'On'
        : 'Off'
      : value
        ? 'Yes'
        : 'No';
  if (key === 'preferredLanguage') {
    try {
      return (
        new Intl.DisplayNames(['en'], { type: 'language' }).of(value) || value
      );
    } catch {
      return value;
    }
  }
  return String(value);
}
export function dashboardError(error, fallback) {
  const { status, data } = error.response || {};
  if (status === 401)
    return 'Your session has expired or is missing. Sign in again with MFA.';
  if (status === 403) {
    if (
      ['2fa_required', 'mfa_verification_required'].includes(data?.reason) ||
      /MFA|two-factor/i.test(data?.error || '')
    )
      return 'A current MFA-verified session is required. Sign in again and complete verification.';
    return 'You do not have permission to perform this action. Contact your access administrator.';
  }
  return data?.error || fallback;
}
