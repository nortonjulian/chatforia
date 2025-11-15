import { jest } from '@jest/globals';

// ---- Mocks ----
const prismaMock = {
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

let bcryptHashMock;

// ESM-safe mock setup
const setupMocks = () => {
  // Mock prisma client used by the script:
  // resetPassword.js: import prisma from '../utils/prismaClient.js';
  jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));

  // Mock bcrypt; always return a deterministic hash
  jest.unstable_mockModule('bcrypt', () => {
    bcryptHashMock = jest.fn((pw, rounds) =>
      Promise.resolve(`hashed-${pw}`)
    );
    return {
      __esModule: true,
      default: {
        hash: bcryptHashMock,
      },
      hash: bcryptHashMock,
    };
  });
};

// Register mocks before any imports
setupMocks();

// ---- Helpers ----
const ORIGINAL_ARGV = process.argv.slice();

/**
 * Re-import the script with a specific argv.
 * We rely on top-level main() executing on import.
 */
const reimportScript = async (argvArray) => {
  jest.resetModules();

  // Restore argv for this run
  process.argv = argvArray;

  // Re-register mocks after resetModules, before script import
  setupMocks();

  // Import the script; it runs main() on import
  return import('../resetPassword.js');
};

describe('scripts/resetPassword.js', () => {
  let exitSpy;
  let logSpy;
  let errSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.user.findFirst.mockReset();
    prismaMock.user.update.mockReset();
    if (bcryptHashMock) bcryptHashMock.mockClear();

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

    expect(errSpy).toHaveBeenCalledWith(
      'No user found for:',
      'NoUser@example.com'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test('happy path: updates passwordHash and exits(0)', async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: 42,
      username: 'JTN',
      email: 'jtn@example.com',
    });

    prismaMock.user.update.mockResolvedValueOnce({}); // first update succeeds

    await reimportScript([
      'node',
      'server/scripts/resetPassword.js',
      'JTN',
      'SuperSecret123!',
    ]);

    // bcrypt.hash called with provided password
    expect(bcryptHashMock).toHaveBeenCalledWith('SuperSecret123!', 10);

    // First attempt: write to passwordHash (and null out legacy column)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { password: null, passwordHash: 'hashed-SuperSecret123!' },
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

    // First update fails (no passwordHash column in old schema)
    prismaMock.user.update
      .mockRejectedValueOnce(
        new Error('column "passwordHash" does not exist')
      )
      .mockResolvedValueOnce({}); // fallback succeeds

    await reimportScript([
      'node',
      'server/scripts/resetPassword.js',
      'legacyUser',
      'NewerPass!',
    ]);

    // bcrypt.hash called appropriately
    expect(bcryptHashMock).toHaveBeenCalledWith('NewerPass!', 10);

    // First attempt (fails)
    expect(prismaMock.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 7 },
      data: { password: null, passwordHash: 'hashed-NewerPass!' },
    });

    // Fallback attempt (legacy schema)
    expect(prismaMock.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 7 },
      data: { password: 'hashed-NewerPass!' },
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
