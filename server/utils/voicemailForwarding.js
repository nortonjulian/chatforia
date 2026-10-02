// Email forwarding is independent of whether voicemail accepts recordings.
export function canForwardVoicemailEmail(user) {
  return ['PLUS', 'PREMIUM', 'WIRELESS'].includes(
    String(user?.plan || 'FREE').trim().toUpperCase()
  );
}

export function isValidVoicemailEmail(email) {
  return typeof email === 'string' && email.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function voicemailForwardingDestination(user) {
  const email = user?.voicemailForwardEmail?.trim();
  return canForwardVoicemailEmail(user) &&
    user?.voicemailEmailForwardingEnabled === true &&
    isValidVoicemailEmail(email) ? email : null;
}
