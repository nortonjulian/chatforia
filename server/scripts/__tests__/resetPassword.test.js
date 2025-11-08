// ---- Mocks ----
const prismaMock = {
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

jest.mock('../../utils/prismaClient.js', () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
  },
  hash: jest.fn(),
}));

const { hash } = jest.requireMock('bcrypt');

// ---- Helpers ----
const ORIGINAL_ARGV = process.argv.slice();
const reimportScript = async (argvArray) => {
  jest.resetModules();
  // Update argv before import so top-level code reads it
  process.argv = argvArray;
  // Clear module cache so the script runs on import each time
  const path = require.resolve('../resetPassword.js');
  delete require.cache[path];
  return import('../resetPassword.js');
};

describe('scripts/resetPassword.js', () => {
  let exitSpy, logSpy, errSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = ORIGINAL_ARGV.slice();
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  test('prints usage and exits(1) when args missing', async () => {
    await reimportScript(['node', 'server/scripts/resetPassword.js']); // no ident/newPass

    expect(errSpy).toHaveBeenCalledWith(
      'Usage: node scripts/resetPassword.js <username-or-email> <newpass>'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('exits(1) when user not found', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce(null);

    await reimportScript([
      'node',
      'server/scripts/resetPassword.js',
      'NoUser@example.com',
      'NewPass!',
    ]);

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { email: { equals: 'NoUser@example.com', mode: 'insensitive' } },
          { username: { equals: 'NoUser@example.com', mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true, email: true },
    });

    expect(errSpy).toHaveBeenCalledWith('No user found for:', 'NoUser@example.com');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test('happy path: updates passwordHash and exits(0)', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 42,
      username: 'JTN',
      email: 'jtn@example.com',
    });
    hash.mockResolvedValueOnce('hashed_pw');
    prismaMock.user.update.mockResolvedValueOnce({}); // first update succeeds

    await reimportScript([
      'node',
      'server/scripts/resetPassword.js',
      'JTN',
      'SuperSecret123!',
    ]);

    expect(hash).toHaveBeenCalledWith('SuperSecret123!', 10);

    // First attempt: write to passwordHash (and null out legacy column)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { password: null, passwordHash: 'hashed_pw' },
    });

    // No fallback update when first succeeds
    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);

    expect(logSpy).toHaveBeenCalledWith(
      'Password reset OK for user id',
      42,
      'username',
      'JTN'
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test('fallback path: first update throws → writes legacy password field', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 7,
      username: 'legacyUser',
      email: 'legacy@example.com',
    });
    hash.mockResolvedValueOnce('hashed_pw2');

    // First update fails (no passwordHash column in old schema)
    prismaMock.user.update
      .mockRejectedValueOnce(new Error('column "passwordHash" does not exist'))
      .mockResolvedValueOnce({}); // fallback succeeds

    await reimportScript([
      'node',
      'server/scripts/resetPassword.js',
      'legacyUser',
      'NewerPass!',
    ]);

    // First attempt (fails)
    expect(prismaMock.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 7 },
      data: { password: null, passwordHash: 'hashed_pw2' },
    });

    // Fallback attempt (legacy schema)
    expect(prismaMock.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 7 },
      data: { password: 'hashed_pw2' },
    });

    expect(logSpy).toHaveBeenCalledWith(
      'Password reset OK for user id',
      7,
      'username',
      'legacyUser'
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
