const androidPushCredentialSid = process.env.TWILIO_ANDROID_PUSH_CREDENTIAL_SID;
const iosPushCredentialSid = process.env.TWILIO_IOS_PUSH_CREDENTIAL_SID;

// Detect Android/iOS without breaking web
const platform = String(
  req.body?.platform ||
  req.query?.platform ||
  req.get('x-chatforia-platform') ||
  req.get('user-agent') ||
  ''
).toLowerCase();

const isAndroid = platform.includes('android');

const isIOS =
  platform.includes('ios') ||
  platform.includes('iphone') ||
  platform.includes('ipad') ||
  platform.includes('cfnetwork') ||
  platform.includes('darwin');

const voiceGrantOptions = {
  outgoingApplicationSid: appSid,
  incomingAllow: true,
};

if (isAndroid && androidPushCredentialSid) {
  voiceGrantOptions.pushCredentialSid = androidPushCredentialSid;
} else if (isIOS && iosPushCredentialSid) {
  voiceGrantOptions.pushCredentialSid = iosPushCredentialSid;
}

console.log('[voiceClient] token platform', {
  userId,
  identity,
  platform,
  isAndroid,
  isIOS,
  hasAndroidPushCredentialSid: Boolean(androidPushCredentialSid),
  hasIosPushCredentialSid: Boolean(iosPushCredentialSid),
  selectedPushCredentialSid: voiceGrantOptions.pushCredentialSid || null,
});