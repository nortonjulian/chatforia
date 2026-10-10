import { describe, it, expect } from '@jest/globals';
import { canForwardVoicemailEmail, voicemailForwardingDestination } from '../voicemailForwarding.js';
import { serializeUser } from '../serializeUser.js';

const configured = { plan: 'PLUS', voicemailForwardEmail: 'voice@example.com', voicemailEmailForwardingEnabled: true };

describe('voicemail email forwarding entitlement and consent', () => {
  it.each(['PLUS', 'PREMIUM'])('allows enabled forwarding for %s', (plan) => {
    expect(voicemailForwardingDestination({ ...configured, plan })).toBe('voice@example.com');
  });

  it('blocks Wireless because data plans do not grant app forwarding entitlements', () => {
    expect(
      voicemailForwardingDestination({
        ...configured,
        plan: 'WIRELESS',
      })
    ).toBeNull();
  });
  it.each(['FREE', '', 'UNKNOWN'])('blocks delivery after downgrade to %s while retaining preferences', (plan) => {
    const user = { ...configured, plan };
    expect(voicemailForwardingDestination(user)).toBeNull();
    expect(serializeUser(user)).toMatchObject({
      canForwardVoicemailEmail: false,
      voicemailEmailForwardingEnabled: true,
      voicemailForwardEmail: 'voice@example.com',
    });
  });
  it('does not use an address as implicit consent', () => {
    expect(voicemailForwardingDestination({ ...configured, voicemailEmailForwardingEnabled: false })).toBeNull();
    expect(voicemailForwardingDestination({ plan: 'PLUS', voicemailForwardEmail: 'voice@example.com' })).toBeNull();
  });
  it.each([null, '', 'invalid', 'a@', 'a b@example.com'])('does not send to invalid address %s', (email) => {
    expect(voicemailForwardingDestination({ ...configured, voicemailForwardEmail: email })).toBeNull();
  });
  it('does not couple email forwarding to voicemail availability', () => {
    const saved = serializeUser({ ...configured, voicemailEnabled: false });
    expect(saved.voicemailEnabled).toBe(false);
    expect(saved.voicemailEmailForwardingEnabled).toBe(true);
    expect(canForwardVoicemailEmail(undefined)).toBe(false);
  });
});
