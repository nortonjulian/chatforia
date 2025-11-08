const prismaMock = {
  messageKey: {
    count: jest.fn(),
    upsert: jest.fn(),
  },
  $queryRawUnsafe: jest.fn(),
  $executeRawUnsafe: jest.fn(),
  $disconnect: jest.fn(),
};

jest.mock('../../utils/prismaClient.js', () => {
  // Not used in this script, but in case your jest environment auto-loads it somewhere else
  return { __esModule: true, default: prismaMock, prisma: prismaMock };
});

// The script imports { PrismaClient } directly from @prisma/client
jest.mock('@prisma/client', () => {
  class PrismaClient {
    constructor() {
      return prismaMock;
    }
  }
  return { __esModule: true, PrismaClient };
});

const reimportScript = async () => {
  jest.resetModules();
  // Clear Node's module cache for this script so top-level main() runs again
  const path = require.resolve('../migrateEncryptedKeys.js');
  delete require.cache[path];
  return import('../migrateEncryptedKeys.js');
};

describe('migrateEncryptedKeys script', () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    prismaMock.messageKey.count.mockResolvedValue(0);
  });

  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    process.env = ORIGINAL_ENV;
  });

  test('Postgres: legacy column missing → logs and exit(0)', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db';
    // Simulate Prisma P2010 with meta.code 42703 (undefined column)
    const e = new Error('P2010');
    e.code = 'P2010';
    e.meta = { code: '42703' };
    prismaMock.$queryRawUnsafe.mockRejectedValueOnce(e);

    await reimportScript();

    expect(logSpy).toHaveBeenCalledWith('DB detected: postgres');
    expect(logSpy).toHaveBeenCalledWith('No legacy encryptedKeys column found. Nothing to migrate.');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });

  test('SQLite: legacy column missing → logs and exit(0)', async () => {
    process.env.DATABASE_URL = 'file:./dev.sqlite';
    prismaMock.$queryRawUnsafe.mockRejectedValueOnce(new Error('no such column: encryptedKeys'));

    await reimportScript();

    expect(logSpy).toHaveBeenCalledWith('DB detected: sqlite');
    expect(logSpy).toHaveBeenCalledWith('No legacy encryptedKeys column found. Nothing to migrate.');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });

  test('MySQL: legacy column missing → logs and exit(0)', async () => {
    process.env.DATABASE_URL = 'mysql://user:pass@host/db';
    prismaMock.$queryRawUnsafe.mockRejectedValueOnce(new Error("Unknown column 'encryptedKeys'"));

    await reimportScript();

    expect(logSpy).toHaveBeenCalledWith('DB detected: mysql');
    expect(logSpy).toHaveBeenCalledWith('No legacy encryptedKeys column found. Nothing to migrate.');
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });

  test('Happy path (postgres): migrates entries, skips bad ones, nulls legacy column', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@host/db';

    // Rows returned from legacy column
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([
      // id 1: encryptedKeys as JSON string
      {
        id: 1,
        encryptedKeys: JSON.stringify({
          '101': 'encKey101',
          'bad': 123,          // bad user id/non-string → skip
          '0': 'zero-is-ok?',  // 0 parses to 0 (allowed? code treats <= not special; will allow 0 but not finite >? It checks Number.isFinite(userId) so 0 is finite, allowed)
        }),
      },
      // id 2: encryptedKeys as object
      {
        id: 2,
        encryptedKeys: {
          '202': 'encKey202',
          '': 'nope',          // NaN user id → skip
        },
      },
      // id 3: unparsable string
      { id: 3, encryptedKeys: '{not json}' },
      // id 4: not an object
      { id: 4, encryptedKeys: '42' },
    ]);

    // Upsert resolves
    prismaMock.messageKey.upsert.mockResolvedValue({});

    await reimportScript();

    // Sanity check logged counts
    expect(logSpy).toHaveBeenCalledWith('DB detected: postgres');
    expect(logSpy).toHaveBeenCalledWith('Found 4 messages with encryptedKeys');

    // Skips unparsable JSON for id 3
    expect(warnSpy).toHaveBeenCalledWith('Message 3: could not parse encryptedKeys as JSON, skipping');
    // Skips non-object for id 4
    expect(warnSpy).toHaveBeenCalledWith('Message 4: encryptedKeys is not an object, skipping');
    // Skips bad user entry in id 1
    expect(warnSpy).toHaveBeenCalledWith('Message 1: bad entry (bad), skipping');
    // For id 2, empty key becomes NaN → skip
    expect(warnSpy).toHaveBeenCalledWith('Message 2: bad entry (), skipping');

    // Upserts expected valid pairs:
    // id 1: 101 + (0 allowed)
    expect(prismaMock.messageKey.upsert).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: 1, userId: 101 } },
      update: { encryptedKey: 'encKey101' },
      create: { messageId: 1, userId: 101, encryptedKey: 'encKey101' },
    });
    expect(prismaMock.messageKey.upsert).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: 1, userId: 0 } },
      update: { encryptedKey: 'zero-is-ok?' },
      create: { messageId: 1, userId: 0, encryptedKey: 'zero-is-ok?' },
    });

    // id 2: 202
    expect(prismaMock.messageKey.upsert).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: 2, userId: 202 } },
      update: { encryptedKey: 'encKey202' },
      create: { messageId: 2, userId: 202, encryptedKey: 'encKey202' },
    });

    // Created/updated count should be logged (3 valid entries)
    expect(logSpy).toHaveBeenCalledWith('Created/updated 3 MessageKey rows.');

    // Optional nulling of legacy column runs (postgres variant)
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      'UPDATE "Message" SET "encryptedKeys" = NULL WHERE "encryptedKeys" IS NOT NULL'
    );

    expect(logSpy).toHaveBeenCalledWith('Done.');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });

  test('Unknown error during legacy fetch → logs error, exit(1)', async () => {
    process.env.DATABASE_URL = 'postgres://u:p@h/db';
    prismaMock.$queryRawUnsafe.mockRejectedValueOnce(new Error('boom'));

    await reimportScript();

    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(prismaMock.$disconnect).toHaveBeenCalledTimes(1);
  });

  test('nullOutEncryptedKeys uses correct SQL per provider (sqlite & mysql)', async () => {
    // SQLite
    process.env.DATABASE_URL = 'file:dev.sqlite';
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([]); // no rows, just to reach nulling
    await reimportScript();
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      'UPDATE Message SET encryptedKeys = NULL WHERE encryptedKeys IS NOT NULL'
    );
    prismaMock.$executeRawUnsafe.mockClear();

    // MySQL
    process.env.DATABASE_URL = 'mysql://u:p@h/db';
    prismaMock.$queryRawUnsafe.mockResolvedValueOnce([]);
    await reimportScript();
    expect(prismaMock.$executeRawUnsafe).toHaveBeenCalledWith(
      'UPDATE Message SET encryptedKeys = NULL WHERE encryptedKeys IS NOT NULL'
    );
  });
});
