import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from '@jest/globals';

const ORIGINAL_ENV = process.env;

// Explicit defaults for all OAuth-related env vars so tests don't pick up your real .env
const OAUTH_ENV_DEFAULTS = {
  // GOOGLE
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_CALLBACK_URL: '',

  // APPLE
  APPLE_SERVICE_ID: '',
  APPLE_TEAM_ID: '',
  APPLE_KEY_ID: '',
  APPLE_PRIVATE_KEY: '',
  APPLE_PRIVATE_KEY_PATH: '',
  APPLE_CALLBACK_URL: '',
};

let passportUseMock;
let googleStrategyCtor;
let appleStrategyCtor;
let fsReadFileSyncMock;

let lastGoogleStrategy; // optional capture (used in one test)
let lastAppleStrategy;  // optional capture (not relied upon for assertions)

// ---- Mocks ----
const mockPassport = async () => {
  passportUseMock = jest.fn();
  await jest.unstable_mockModule('passport', () => ({
    __esModule: true,
    default: { use: passportUseMock },
  }));
};

const mockGoogle = async () => {
  class MockGoogleStrategy {
    constructor(opts, verify) {
      this.name = 'google';
      this.options = opts;
      this.verify = verify;
      lastGoogleStrategy = this;
    }
  }
  googleStrategyCtor = MockGoogleStrategy;

  await jest.unstable_mockModule('passport-google-oauth20', () => ({
    __esModule: true,
    Strategy: MockGoogleStrategy,
  }));
};

const mockApple = async () => {
  class MockAppleStrategy {
    constructor(opts, verify) {
      this.name = 'apple';
      this.options = opts;
      this.verify = verify;
      lastAppleStrategy = this;
    }
  }
  appleStrategyCtor = MockAppleStrategy;

  await jest.unstable_mockModule('passport-apple', () => ({
    __esModule: true,
    default: MockAppleStrategy,
  }));
};

const mockFs = async (fileContent) => {
  fsReadFileSyncMock = jest.fn();

  if (fileContent !== undefined) {
    fsReadFileSyncMock.mockReturnValue(fileContent);
  }

  await jest.unstable_mockModule('node:fs', () => ({
    __esModule: true,
    // We only need readFileSync for the APPLE_PRIVATE_KEY_PATH branch
    readFileSync: fsReadFileSyncMock,
  }));
};

// Helper to reload module-under-test with fresh mocks/env
const reload = async (env = {}, opts = {}) => {
  jest.resetModules();

  // Start from ORIGINAL_ENV, but force all OAuth vars to known defaults,
  // then layer per-test overrides on top.
  process.env = {
    ...ORIGINAL_ENV,
    ...OAUTH_ENV_DEFAULTS,
    ...env,
  };

  // register all mocks before importing passport.js
  await mockPassport();
  await mockGoogle();
  await mockApple();
  await mockFs(opts.fsContent);

  // Silence console output during tests
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

beforeEach(() => {
  // just to be explicit; jest.setup also clears in server/__tests__/jest.setup.js
  jest.clearAllMocks();
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

    // Only Google strategy should be registered
    expect(passportUseMock).toHaveBeenCalledTimes(1);
    const strategyInstance = lastGoogleStrategy;
    expect(strategyInstance).toBeInstanceOf(googleStrategyCtor);

    // Options wired correctly
    expect(strategyInstance.options).toMatchObject({
      clientID: 'gid_123',
      clientSecret: 'gsec_456',
      callbackURL: 'https://app.chatforia.com/auth/google/callback',
      passReqToCallback: true,
    });

    // Verify callback maps fields → user object
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
    const inlineKey =
      '-----BEGIN PRIVATE KEY-----\\nline1\\nline2\\n-----END PRIVATE KEY-----';

    await reload({
      APPLE_SERVICE_ID: 'com.chatforia.web',
      APPLE_TEAM_ID: 'TEAMID123',
      APPLE_KEY_ID: 'KEYID456',
      APPLE_PRIVATE_KEY: inlineKey,
      APPLE_CALLBACK_URL: 'https://app.chatforia.com/auth/apple/callback',
    });

    // Apple strategy should be registered
    const appleCall = passportUseMock.mock.calls.find(
      ([strategy]) => strategy && strategy.name === 'apple'
    );
    expect(appleCall).toBeTruthy();
    const [strategyInstance] = appleCall;

    expect(strategyInstance).toBeInstanceOf(appleStrategyCtor);
    expect(strategyInstance.options).toMatchObject({
      clientID: 'com.chatforia.web',
      teamID: 'TEAMID123',
      keyID: 'KEYID456',
      callbackURL: 'https://app.chatforia.com/auth/apple/callback',
      scope: ['name', 'email'],
      passReqToCallback: true,
    });
    // \n expansion validated
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
    await reload(
      {
        APPLE_SERVICE_ID: 'com.chatforia.web',
        APPLE_TEAM_ID: 'TEAMID123',
        APPLE_KEY_ID: 'KEYID456',
        APPLE_PRIVATE_KEY_PATH: '/secure/key.p8',
        APPLE_CALLBACK_URL: 'https://app.chatforia.com/auth/apple/callback',
      },
      { fsContent: '---KEY FROM FILE---' }
    );

    expect(fsReadFileSyncMock).toHaveBeenCalledWith('/secure/key.p8', 'utf8');

    // Assert off the actual passport.use call (no reliance on global capture)
    const appleCall = passportUseMock.mock.calls.find(
      ([strategy]) => strategy && strategy.name === 'apple'
    );
    expect(appleCall).toBeTruthy();
    const [strategyInstance] = appleCall;

    expect(strategyInstance).toBeInstanceOf(appleStrategyCtor);
    expect(strategyInstance.options).toMatchObject({
      clientID: 'com.chatforia.web',
      teamID: 'TEAMID123',
      keyID: 'KEYID456',
      callbackURL: 'https://app.chatforia.com/auth/apple/callback',
      scope: ['name', 'email'],
      passReqToCallback: true,
    });
    expect(strategyInstance.options.privateKey).toBe('---KEY FROM FILE---');
  });

  test('Apple env present but private key resolves empty → logs error and does not register', async () => {
    await reload(
      {
        APPLE_SERVICE_ID: 'com.chatforia.web',
        APPLE_TEAM_ID: 'TEAMID123',
        APPLE_KEY_ID: 'KEYID456',
        APPLE_PRIVATE_KEY_PATH: '/secure/key.p8',
        APPLE_CALLBACK_URL: 'https://app.chatforia.com/auth/apple/callback',
      },
      { fsContent: '' } // simulate empty file
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/\[oauth] APPLE private key missing/i)
    );

    // Should not have registered Apple strategy
    const appleCall = passportUseMock.mock.calls.find(
      ([strategy]) => strategy && strategy.name === 'apple'
    );
    expect(appleCall).toBeUndefined();
  });
});
