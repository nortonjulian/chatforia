import crypto from 'crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

let messaging = null;

function cleanPrivateKey(rawKey) {
  if (!rawKey) return null;

  return String(rawKey)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\n/g, '\n')
    .trim();
}

export function getFirebaseMessaging() {
  if (messaging) return messaging;

  const {
    FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY,
  } = process.env;

  const privateKey = cleanPrivateKey(FIREBASE_PRIVATE_KEY);

  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !privateKey) {
    console.warn('[firebase] Firebase Admin not configured');
    return null;
  }

  try {
    crypto.createPrivateKey(privateKey);
  } catch (err) {
    console.error('[firebase] Invalid private key', {
      startsWithBegin: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
      endsWithEnd: privateKey.endsWith('-----END PRIVATE KEY-----'),
      hasRealNewlines: privateKey.includes('\n'),
      hasLiteralBackslashN: privateKey.includes('\\n'),
      length: privateKey.length,
      message: err.message,
      code: err.code,
      reason: err.reason,
    });

    return null;
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
  }

  messaging = getMessaging();

  console.log('[firebase] Firebase Admin initialized');

  return messaging;
}