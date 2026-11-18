import assert from 'node:assert/strict';
import test from 'node:test';
import { needsIncomingCallAlert } from '../incomingCallAlertTargets.js';

const dialed = new Set(['ios-1']);
const registered = {
  deviceId: 'ios-1', voicePushEnvironment: 'production',
  voipPushToken: 'synthetic-voip-token', apnsPushToken: 'synthetic-alert-token',
};

test('a dialed iOS device with matching VoIP registration omits duplicate alert', () => {
  assert.equal(needsIncomingCallAlert(registered, 'production', dialed), false);
});

test('undialed and unregistered devices retain ordinary alert fallback', () => {
  assert.equal(needsIncomingCallAlert({ ...registered, deviceId: 'ios-2' }, 'production', dialed), true);
  assert.equal(needsIncomingCallAlert({ ...registered, voipPushToken: null }, 'production', dialed), true);
  assert.equal(needsIncomingCallAlert(registered, 'production', new Set()), true);
});

test('environment mismatch keeps alert; sandbox VoIP is filtered only in sandbox', () => {
  assert.equal(needsIncomingCallAlert(registered, 'sandbox', dialed), true);
  const sandbox = { ...registered, voicePushEnvironment: 'sandbox', voipSandboxPushToken: 'synthetic-sandbox' };
  assert.equal(needsIncomingCallAlert(sandbox, 'sandbox', dialed), false);
  assert.equal(needsIncomingCallAlert(sandbox, 'production', dialed), true);
});
