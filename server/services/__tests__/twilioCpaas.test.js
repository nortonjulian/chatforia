// server/services/__tests__/twilioCpaas.test.js
import { jest } from '@jest/globals';

// --- Set env BEFORE importing the module under test ---
process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
process.env.TWILIO_API_KEY_SID = 'SK_test_key_sid';
process.env.TWILIO_API_KEY_SECRET = 'secret_key_123';

// --- Fake AccessToken / Grants implementation ---
class FakeVideoGrant {
  constructor(opts) {
    this.opts = opts;
  }
}

class FakeVoiceGrant {
  constructor(opts) {
    this.opts = opts;
  }
}

class FakeAccessToken {
  constructor(accountSid, apiKeySid, apiKeySecret, options) {
    this.accountSid = accountSid;
    this.apiKeySid = apiKeySid;
    this.apiKeySecret = apiKeySecret;
    this.options = options;
    this.grants = [];
    FakeAccessToken.instances.push(this);
  }

  addGrant(grant) {
    this.grants.push(grant);
  }

  toJwt() {
    return 'fake-jwt-token';
  }
}
FakeAccessToken.instances = [];
FakeAccessToken.VideoGrant = FakeVideoGrant;
FakeAccessToken.VoiceGrant = FakeVoiceGrant;

// --- Mock twilio BEFORE importing twilioCpaas ---
const mockTwilio = {
  jwt: {
    AccessToken: FakeAccessToken,
  },
};

await jest.unstable_mockModule('twilio', () => ({
  __esModule: true,
  default: mockTwilio,
}));

// --- Now import the function under test ---
const { createVideoToken } = await import('../providers/twilioCpaas.js');

describe('createVideoToken', () => {
  beforeEach(() => {
    FakeAccessToken.instances.length = 0;
    jest.clearAllMocks();
  });

  it('creates a Twilio AccessToken with VideoGrant and returns JWT', () => {
    const identity = 'user-123';
    const room = 'room-xyz';

    const jwt = createVideoToken({ identity, room });

    // Returned value should be whatever FakeAccessToken.toJwt() returns
    expect(jwt).toBe('fake-jwt-token');

    // One AccessToken instance should have been created
    expect(FakeAccessToken.instances).toHaveLength(1);
    const inst = FakeAccessToken.instances[0];

    // Constructor args came from env and identity
    expect(inst.accountSid).toBe('AC_test_sid');
    expect(inst.apiKeySid).toBe('SK_test_key_sid');
    expect(inst.apiKeySecret).toBe('secret_key_123');
    expect(inst.options).toEqual({ identity });

    // Grant created and added
    expect(inst.grants).toHaveLength(1);
    const grant = inst.grants[0];
    expect(grant).toBeInstanceOf(FakeVideoGrant);
    expect(grant.opts).toEqual({ room });
  });
});
