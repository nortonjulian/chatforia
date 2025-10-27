import { jest } from '@jest/globals';

// This suite stubs @prisma/client with a fake PrismaClient that we fully control.
// We then import prismaClient.js and assert that it:
//   - normalizes inputs to create/createMany for Message, Participant, ChatRoom
//   - coerces booleans
//   - maps authorId/chatRoomId to connect
//   - maps roomId -> chatRoomId
//   - wraps participant.upsert with FK healing when NODE_ENV=test
//   - auto-provisions users on findUnique/findFirst miss-by-email in test env
//   - memoizes prisma on globalThis.__prisma in non-production

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_GLOBAL = { ...globalThis };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // clean up memoized prisma
  delete globalThis.__prisma;
  jest.resetModules();
  jest.restoreAllMocks();
});

//
// We'll build a fake Prisma implementation
//
function makeFakePrisma() {
  // We'll simulate middleware by capturing fns pushed via $use
  const middlewares = [];

  const middlewareRunner = async (params, finalImpl) => {
    // Compose like Prisma does: last middleware wraps next(), etc.
    // We'll chain manually:
    let idx = -1;
    const run = async (i, p) => {
      if (i === middlewares.length) {
        return finalImpl(p);
      }
      const mw = middlewares[i];
      return mw(p, (nextParams) => run(i + 1, nextParams));
    };
    return run(0, params);
  };

  // We'll hold fake tables in-memory (super minimal) so we can test FK healing, auto-provision, etc.
  const db = {
    user: [],
    participant: [],
    message: [],
    chatRoom: [],
  };

  // Auto-increment helper
  let idCounter = 1;
  const nextId = () => idCounter++;

  // Helpers used by delegate methods:
  function userFindUnique(args) {
    const where = args?.where || {};
    if ('id' in where) {
      return db.user.find((u) => u.id === where.id) || null;
    }
    if ('email' in where) {
      return db.user.find((u) => u.email === where.email) || null;
    }
    return null;
  }
  function userFindFirst(args) {
    // for tests we only really need email-based lookup
    const where = args?.where || {};
    if ('email' in where) {
      if (typeof where.email === 'string') {
        return db.user.find((u) => u.email === where.email) || null;
      }
      if (where.email?.equals) {
        return (
          db.user.find((u) => u.email === where.email.equals) || null
        );
      }
    }
    return null;
  }
  async function userCreate(args) {
    const data = { ...args.data };
    if (!('id' in data)) {
      data.id = nextId();
    }
    db.user.push(data);
    return data;
  }

  async function participantUpsertImpl(args) {
    // We'll simulate FK constraint: participant.userId must exist.
    const userId =
      args?.where?.chatRoomId_userId?.userId ??
      args?.where?.userId_chatRoomId?.userId ??
      args?.create?.userId ??
      args?.update?.userId;

    const foundUser = db.user.find((u) => u.id === userId);
    if (!foundUser) {
      // simulate Prisma FK error format
      const err = new Error(
        'Foreign key constraint failed on the field: `participant_userId_fkey`'
      );
      err.code = 'P2003';
      throw err;
    }

    // Naive upsert behavior for test:
    // If there's already a participant row matching where, update it; else, create it.
    let row = db.participant.find((p) => {
      if (args.where.chatRoomId_userId) {
        return (
          p.chatRoomId === args.where.chatRoomId_userId.chatRoomId &&
          p.userId === args.where.chatRoomId_userId.userId
        );
      }
      if (args.where.userId_chatRoomId) {
        return (
          p.chatRoomId === args.where.userId_chatRoomId.chatRoomId &&
          p.userId === args.where.userId_chatRoomId.userId
        );
      }
      return false;
    });

    if (!row) {
      row = { ...args.create };
      if (!('id' in row)) row.id = nextId();
      db.participant.push(row);
      return row;
    } else {
      Object.assign(row, args.update);
      return row;
    }
  }

  // We'll fill in delegates. Most of these just record their normalized args
  // so we can assert on them.

  const called = {
    messageCreateArgs: [],
    messageCreateManyArgs: [],
    participantCreateArgs: [],
    participantCreateManyArgs: [],
    chatRoomCreateArgs: [],
    participantUpsertArgs: [],
  };

  const prisma = {
    $use: (fn) => {
      middlewares.push(fn);
    },

    user: {
      findUnique: jest.fn(async (args) =>
        middlewareRunner(
          { model: 'User', action: 'findUnique', args },
          () => userFindUnique(args)
        )
      ),
      findFirst: jest.fn(async (args) =>
        middlewareRunner(
          { model: 'User', action: 'findFirst', args },
          () => userFindFirst(args)
        )
      ),
      create: jest.fn(async (args) =>
        middlewareRunner(
          { model: 'User', action: 'create', args },
          () => userCreate(args)
        )
      ),
    },

    message: {
      create: jest.fn(async (args) => {
        called.messageCreateArgs.push(args);
        return middlewareRunner(
          { model: 'Message', action: 'create', args },
          (finalArgs) => {
            // record normalized finalArgs for assertions
            called.messageCreateArgs.push({ FINAL: finalArgs });
            // pretend insert
            const data = { ...finalArgs.args.data };
            if (!('id' in data)) data.id = nextId();
            db.message.push(data);
            return data;
          }
        );
      }),
      createMany: jest.fn(async (args) => {
        called.messageCreateManyArgs.push(args);
        return middlewareRunner(
          { model: 'Message', action: 'createMany', args },
          (finalArgs) => {
            called.messageCreateManyArgs.push({ FINAL: finalArgs });
            // pretend bulk insert
            const rows = Array.isArray(finalArgs.args.data)
              ? finalArgs.args.data
              : [finalArgs.args.data];
            rows.forEach((row) => {
              const data = { ...row };
              if (!('id' in data)) data.id = nextId();
              db.message.push(data);
            });
            return { count: rows.length };
          }
        );
      }),
    },

    participant: {
      create: jest.fn(async (args) => {
        called.participantCreateArgs.push(args);
        return middlewareRunner(
          { model: 'Participant', action: 'create', args },
          (finalArgs) => {
            called.participantCreateArgs.push({ FINAL: finalArgs });
            const data = { ...finalArgs.args.data };
            if (!('id' in data)) data.id = nextId();
            db.participant.push(data);
            return data;
          }
        );
      }),
      createMany: jest.fn(async (args) => {
        called.participantCreateManyArgs.push(args);
        return middlewareRunner(
          { model: 'Participant', action: 'createMany', args },
          (finalArgs) => {
            called.participantCreateManyArgs.push({ FINAL: finalArgs });
            const rows = Array.isArray(finalArgs.args.data)
              ? finalArgs.args.data
              : [finalArgs.args.data];
            rows.forEach((row) => {
              const data = { ...row };
              if (!('id' in data)) data.id = nextId();
              db.participant.push(data);
            });
            return { count: rows.length };
          }
        );
      }),
      upsert: jest.fn(async (args) => {
        called.participantUpsertArgs.push(args);
        return middlewareRunner(
          { model: 'Participant', action: 'upsert', args },
          async (finalArgs) => {
            called.participantUpsertArgs.push({ FINAL: finalArgs });
            return participantUpsertImpl(finalArgs.args);
          }
        );
      }),
    },

    chatRoom: {
      create: jest.fn(async (args) => {
        called.chatRoomCreateArgs.push(args);
        return middlewareRunner(
          { model: 'ChatRoom', action: 'create', args },
          (finalArgs) => {
            called.chatRoomCreateArgs.push({ FINAL: finalArgs });
            const data = { ...finalArgs.args.data };
            if (!('id' in data)) data.id = nextId();
            db.chatRoom.push(data);
            return data;
          }
        );
      }),
    },

    // not all models are covered here, but enough for tests
    _internals: {
      called,
      db,
      middlewares,
    },
  };

  return prisma;
}

// helper to load prismaClient.js with our fake PrismaClient injected
async function loadPrismaModuleWithFakeClient({ nodeEnv = 'test' } = {}) {
  jest.resetModules();
  process.env.NODE_ENV = nodeEnv;

  // stub bcrypt.hash for the auto-provision user path
  jest.unstable_mockModule('bcrypt', () => ({
    default: {
      hash: jest.fn(async () => 'HASHEDPW'),
    },
  }));

  const fakePrismaInstance = makeFakePrisma();

  // mock @prisma/client to return our fakePrismaInstance
  jest.unstable_mockModule('@prisma/client', () => ({
    PrismaClient: class PrismaClient {
      constructor() {
        return fakePrismaInstance;
      }
    },
  }));

  const mod = await import('../../utils/prismaClient.js');
  return { mod, prisma: mod.default, fake: fakePrismaInstance };
}

describe('prismaClient.js', () => {
  test('reuses a single prisma instance via globalThis.__prisma when not production', async () => {
    delete globalThis.__prisma;

    const { prisma } = await loadPrismaModuleWithFakeClient({
      nodeEnv: 'development',
    });

    // prisma should now be cached on globalThis.__prisma
    expect(globalThis.__prisma).toBe(prisma);

    // Re-import and confirm we get the same instance, not a new one.
    const { prisma: prisma2 } = await loadPrismaModuleWithFakeClient({
      nodeEnv: 'development',
    });
    expect(prisma2).toBe(prisma);
  });

  test('message.create normalizes {content, authorId, chatRoomId} into {rawContent, sender.connect, chatRoom.connect}', async () => {
    const { prisma, fake } = await loadPrismaModuleWithFakeClient();

    await prisma.message.create({
      data: {
        content: 'hello',
        authorId: 5,
        chatRoomId: 10,
        extra: 'keepme',
      },
    });

    const finalCall = fake._internals.called.messageCreateArgs.find(
      (x) => x.FINAL
    ).FINAL;

    expect(finalCall.args.data).toEqual({
      rawContent: 'hello',
      sender: { connect: { id: 5 } },
      chatRoom: { connect: { id: 10 } },
      extra: 'keepme',
    });
  });

  test('message.createMany normalizes each row the same way', async () => {
    const { prisma, fake } = await loadPrismaModuleWithFakeClient();

    await prisma.message.createMany({
      data: [
        {
          content: 'hi',
          authorId: 1,
          chatRoomId: 99,
        },
        {
          rawContent: 'alreadyRaw',
          authorId: 2,
          chatRoomId: 100,
        },
      ],
    });

    const finalCall = fake._internals.called.messageCreateManyArgs.find(
      (x) => x.FINAL
    ).FINAL;

    expect(finalCall.args.data).toEqual([
      {
        rawContent: 'hi',
        sender: { connect: { id: 1 } },
        chatRoom: { connect: { id: 99 } },
      },
      {
        rawContent: 'alreadyRaw',
        sender: { connect: { id: 2 } },
        chatRoom: { connect: { id: 100 } },
      },
    ]);
  });

  test('participant.create / createMany map roomId -> chatRoomId', async () => {
    const { prisma, fake } = await loadPrismaModuleWithFakeClient();

    await prisma.participant.create({
      data: { roomId: 123, role: 'MEMBER', userId: 5 },
    });

    await prisma.participant.createMany({
      data: [
        { roomId: 200, role: 'MODERATOR', userId: 8 },
        { chatRoomId: 201, role: 'ADMIN', userId: 9 },
      ],
    });

    const finalSingle = fake._internals.called.participantCreateArgs.find(
      (x) => x.FINAL
    ).FINAL;
    expect(finalSingle.args.data).toEqual({
      chatRoomId: 123,
      role: 'MEMBER',
      userId: 5,
    });

    const finalMany = fake._internals.called.participantCreateManyArgs.find(
      (x) => x.FINAL
    ).FINAL;
    expect(finalMany.args.data).toEqual([
      { chatRoomId: 200, role: 'MODERATOR', userId: 8 },
      { chatRoomId: 201, role: 'ADMIN', userId: 9 },
    ]);
  });

  test('chatRoom.create coerces isGroup to boolean-like values', async () => {
    const { prisma, fake } = await loadPrismaModuleWithFakeClient();

    await prisma.chatRoom.create({
      data: { name: 'test1', isGroup: 'true' },
    });
    await prisma.chatRoom.create({
      data: { name: 'test2', isGroup: '0' },
    });
    await prisma.chatRoom.create({
      data: { name: 'test3', isGroup: true },
    });

    const finals = fake._internals.called.chatRoomCreateArgs
      .filter((x) => x.FINAL)
      .map((wrap) => wrap.FINAL.args.data);

    expect(finals[0]).toEqual({ name: 'test1', isGroup: true });
    expect(finals[1]).toEqual({ name: 'test2', isGroup: false }); // '0' -> false
    expect(finals[2]).toEqual({ name: 'test3', isGroup: true });
  });

  test('auto-provision user on email lookup miss in test env returns the created user', async () => {
    const { prisma, fake } = await loadPrismaModuleWithFakeClient({
      nodeEnv: 'test',
    });

    const res = await prisma.user.findUnique({
      where: { email: 'newuser@example.com' },
    });

    expect(res).toBeTruthy();
    expect(res.email).toBe('newuser@example.com');
    expect(res.role).toBe('USER');
    expect(res.plan).toBe('FREE');

    const again = await prisma.user.findUnique({
      where: { email: 'newuser@example.com' },
    });
    expect(again).toEqual(res);
  });

  test('participant.upsert wrapper in test env heals missing FK by auto-creating user then retrying', async () => {
    const { prisma, fake } = await loadPrismaModuleWithFakeClient({
      nodeEnv: 'test',
    });

    const out = await prisma.participant.upsert({
      where: {
        chatRoomId_userId: { chatRoomId: 10, userId: 777 },
      },
      create: { chatRoomId: 10, userId: 777, role: 'MEMBER' },
      update: { role: 'MEMBER' },
    });

    expect(out).toMatchObject({
      chatRoomId: 10,
      userId: 777,
      role: 'MEMBER',
    });

    const createdUser = fake._internals.db.user.find((u) => u.id === 777);
    expect(createdUser).toBeTruthy();
    expect(createdUser.email).toBe('user777@example.com');
  });
});
