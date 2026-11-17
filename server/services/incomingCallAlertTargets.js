// Twilio Voice will dial these exact iOS devices through PushKit/CallKit.
// Keep ordinary APNs alerts for other devices as fallback.
export function needsIncomingCallAlert(device, environment, callKitDeviceIds) {
  if (!callKitDeviceIds?.has(device.deviceId)) return true;
  if (device.voicePushEnvironment !== environment) return true;
  return environment === 'sandbox'
    ? !device.voipSandboxPushToken
    : !device.voipPushToken;
}
