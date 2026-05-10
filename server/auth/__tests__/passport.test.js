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

const OAUTH_ENV_DEFAULTS = {
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_CALLBACK_URL: '',
};

let passportUseMock;
let googleStrategyCtor;
let resolveOAuthUserMock;
let lastGoogleStrategy;

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

const mockOAuthIdentity = async () => {
  resolveOAuthUserMock = jest.fn();

  await jest.unstable_mockModule('../services/oauthIdentity.js', () => ({
    __esModule: true,
    resolveOAuthUser: resolveOAuthUserMock,
  }));
};

const reload = async (env = {}) => {
  jest.resetModules();

  process.env = {
    ...ORIGINAL_ENV,
    ...OAUTH_ENV_DEFAULTS,
    ...env,
  };

  await mockPassport();
  await mockGoogle();
  await mockOAuthIdentity();

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
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('passport auth strategies', () => {
  test('Google disabled when env not set', async () => {
    await reload({
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      GOOGLE_CALLBACK_URL: '',
    });

    expect(passportUseMock).not.toHaveBeenCalled();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/\[oauth] GOOGLE_\* not set/i)
    );
  });

  test('Google enabled: registers strategy and verify returns resolved OAuth user', async () => {
    const resolvedUser = {
      id: 3971,
      username: 'pending_julian',
      email: 'julian@example.com',
      googleSub: 'google-user-1',
      displayName: 'Julian Norton',
      avatarUrl: 'https://example.com/a.jpg',
      plan: 'FREE',
    };

    await reload({
      GOOGLE_CLIENT_ID: 'gid_123',
      GOOGLE_CLIENT_SECRET: 'gsec_456',
      GOOGLE_CALLBACK_URL: 'https://app.chatforia.com/auth/google/callback',
    });

    resolveOAuthUserMock.mockResolvedValueOnce(resolvedUser);

    expect(passportUseMock).toHaveBeenCalledTimes(1);

    const strategyInstance = lastGoogleStrategy;

    expect(strategyInstance).toBeInstanceOf(googleStrategyCtor);

    expect(strategyInstance.options).toMatchObject({
      clientID: 'gid_123',
      clientSecret: 'gsec_456',
      callbackURL: 'https://app.chatforia.com/auth/google/callback',
      passReqToCallback: true,
    });

    const done = jest.fn();

    const profile = {
      id: 'google-user-1',
      displayName: ' Julian Norton ',
      emails: [{ value: ' Julian@Example.com ' }],
      photos: [{ value: 'https://example.com/a.jpg' }],
    };

    await strategyInstance.verify(
      { originalUrl: '/auth/google/callback' },
      'tokA',
      'tokR',
      profile,
      done
    );

    expect(resolveOAuthUserMock).toHaveBeenCalledWith({
      provider: 'google',
      providerSub: 'google-user-1',
      email: 'julian@example.com',
      emailVerified: true,
      displayName: 'Julian Norton',
      avatarUrl: 'https://example.com/a.jpg',
      logContext: {
        channel: 'web-passport',
        path: '/auth/google/callback',
      },
    });

    expect(done).toHaveBeenCalledWith(null, resolvedUser);
  });

  test('Google verify returns error when profile id is missing', async () => {
    await reload({
      GOOGLE_CLIENT_ID: 'gid_123',
      GOOGLE_CLIENT_SECRET: 'gsec_456',
    });

    const strategyInstance = lastGoogleStrategy;
    const done = jest.fn();

    await strategyInstance.verify({}, 'tokA', 'tokR', {}, done);

    expect(done).toHaveBeenCalledTimes(1);

    const [error] = done.mock.calls[0];

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Google profile id missing');
    expect(resolveOAuthUserMock).not.toHaveBeenCalled();
  });
});