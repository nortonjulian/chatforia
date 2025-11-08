const ORIGINAL_ENV = process.env;

let passportUseMock;
let googleStrategyCtor;
let appleStrategyCtor;
let fsReadFileSyncMock;

let lastGoogleStrategy; // capture latest constructed strategy (our mock)
let lastAppleStrategy;

const mockPassport = () => {
  passportUseMock = jest.fn();
  jest.doMock('passport', () => ({
    __esModule: true,
    default: { use: passportUseMock },
  }));
};

const mockGoogle = () => {
  // Our fake Strategy captures options and verify
  class MockGoogleStrategy {
    constructor(opts, verify) {
      this.name = 'google';
      this.options = opts;
      this.verify = verify;
      lastGoogleStrategy = this;
    }
  }
  googleStrategyCtor = MockGoogleStrategy;
  jest.doMock('passport-google-oauth20', () => ({
    __esModule: true,
    Strategy: MockGoogleStrategy,
  }));
};

const mockApple = () => {
  class MockAppleStrategy {
    constructor(opts, verify) {
      this.name = 'apple';
      this.options = opts;
      this.verify = verify;
      lastAppleStrategy = this;
    }
  }
  appleStrategyCtor = MockAppleStrategy;
  jest.doMock('passport-apple', () => ({
    __esModule: true,
    default: MockAppleStrategy,
  }));
};

const mockFs = () => {
  fsReadFileSyncMock = jest.fn();
  jest.doMock('node:fs', () => ({
    __esModule: true,
    default: {},
    readFileSync: fsReadFileSyncMock,
  }));
};

const reload = async (env = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  mockPassport();
  mockGoogle();
  mockApple();
  mockFs();

  // Silence console in tests but keep call visibility
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  return import('../passport.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

afterEach(() => {
  jest.restoreAllMocks();
  lastGoogleStrategy = undefined;
  lastAppleStrategy = undefined;
});

describe('passport auth strategies', () => {
  test('Google disabled when env not set; Apple disabled when env not set', async () => {
    await reload({
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      APPLE_SERVICE_ID: '',
      APPLE_TEAM_ID: '',
      APPLE_KEY_ID: '',
      APPLE_PRIVATE_KEY: '',
      APPLE_PRIVATE_KEY_PATH: '',
    });

    expect(passportUseMock).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/\[oauth] GOOGLE_\* not set/i)
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/\[oauth] APPLE_\* not set/i)
    );
  });

  test('Google enabled: registers strategy and verify returns mapped user', async () => {
    await reload({
      GOOGLE_CLIENT_ID: 'gid_123',
      GOOGLE_CLIENT_SECRET: 'gsec_456',
      GOOGLE_CALLBACK_URL: 'https://app.chatforia.com/auth/google/callback',
    });

    expect(passportUseMock).toHaveBeenCalledTimes(1);
    const strategyInstance = lastGoogleStrategy;
    expect(strategyInstance).toBeInstanceOf(googleStrategyCtor);

    // Options
    expect(strategyInstance.options).toMatchObject({
      clientID: 'gid_123',
      clientSecret: 'gsec_456',
      callbackURL: 'https://app.chatforia.com/auth/google/callback',
      passReqToCallback: true,
    });

    // Verify callback: (req, accessToken, refreshToken, profile, done)
    const done = jest.fn();
    const profile = {
      id: 'google-user-1',
      displayName: 'Julian Norton',
      emails: [{ value: 'julian@example.com' }],
      photos: [{ value: 'https://example.com/a.jpg' }],
    };

    await strategyInstance.verify({}, 'tokA', 'tokR', profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      id: 'google:google-user-1',
      provider: 'google',
      email: 'julian@example.com',
      name: 'Julian Norton',
      avatarUrl: 'https://example.com/a.jpg',
    });
  });

  test('Apple enabled via inline APPLE_PRIVATE_KEY: registers strategy and verify maps user', async () => {
    // Inline key with literal \n should be converted to newlines
    const inlineKey = '-----BEGIN PRIVATE KEY-----\\nline1\\nline2\\n-----END PRIVATE KEY-----';

    await reload({
      APPLE_SERVICE_ID: 'com.chatforia.web',
      APPLE_TEAM_ID: 'TEAMID123',
      APPLE_KEY_ID: 'KEYID456',
      APPLE_PRIVATE_KEY: inlineKey,
      APPLE_CALLBACK_URL: 'https://app.chatforia.com/auth/apple/callback',
    });

    // Apple strategy should be registered (plus possibly Google log lines; we only care Apple here)
    expect(passportUseMock).toHaveBeenCalledTimes(1);
    const strategyInstance = lastAppleStrategy;
    expect(strategyInstance).toBeInstanceOf(appleStrategyCtor);

    // Private key should have \n expanded
    expect(strategyInstance.options).toMatchObject({
      clientID: 'com.chatforia.web',
      teamID: 'TEAMID123',
      keyID: 'KEYID456',
      callbackURL: 'https://app.chatforia.com/auth/apple/callback',
      scope: ['name', 'email'],
      passReqToCallback: true,
    });
    expect(strategyInstance.options.privateKey).toContain('line1\nline2');

    // Verify callback maps id/email/name
    const done = jest.fn();
    const idToken = { sub: 'apple-user-99', email: 'appleuser@example.com' };
    const profile = { name: { givenName: 'Jane', familyName: 'Doe' } };

    await strategyInstance.verify({}, 'accTok', 'refTok', idToken, profile, done);

    expect(done).toHaveBeenCalledWith(null, {
      id: 'apple:apple-user-99',
      provider: 'apple',
      email: 'appleuser@example.com',
      name: 'Jane Doe',
      avatarUrl: null,
    });
  });

  test('Apple enabled via APPLE_PRIVATE_KEY_PATH: reads key file and registers strategy', async () => {
    fsReadFileSyncMock.mockReturnValue('---KEY FROM FILE---');

    await reload({
      APPLE_SERVICE_ID: 'com.chatforia.web',
      APPLE_TEAM_ID: 'TEAMID123',
      APPLE_KEY_ID: 'KEYID456',
      APPLE_PRIVATE_KEY_PATH: '/secure/key.p8',
      APPLE_CALLBACK_URL: 'https://app.chatforia.com/auth/apple/callback',
    });

    expect(fsReadFileSyncMock).toHaveBeenCalledWith('/secure/key.p8', 'utf8');
    expect(passportUseMock).toHaveBeenCalledTimes(1);
    expect(lastAppleStrategy.options.privateKey).toBe('---KEY FROM FILE---');
  });

  test('Apple env present but private key resolves empty → logs error and does not register', async () => {
    // Make readFileSync return empty string, causing falsy privateKey
    fsReadFileSyncMock.mockReturnValue('');

    await reload({
      APPLE_SERVICE_ID: 'com.chatforia.web',
      APPLE_TEAM_ID: 'TEAMID123',
      APPLE_KEY_ID: 'KEYID456',
      APPLE_PRIVATE_KEY_PATH: '/secure/key.p8',
      APPLE_CALLBACK_URL: 'https://app.chatforia.com/auth/apple/callback',
    });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[oauth] APPLE private key missing/i)
    );
    // Should not have registered Apple strategy
    expect(passportUseMock).not.toHaveBeenCalled();
  });
});
