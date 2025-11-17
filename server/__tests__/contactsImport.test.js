import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import express from 'express';
import request from 'supertest';

const ORIGINAL_ENV = process.env;

let prismaMock;
let parsePhoneNumberFromStringMock;

// -------------------- Mocks --------------------

// prisma client
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    contact: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    __esModule: true,
    default: prismaMock,
  };
});

// requireAuth → inject a fake user
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id'] || '1');
    req.user = { id };
    next();
  },
}));

// mediumLimiter → no-op rate limiter
await jest.unstable_mockModule('../middleware/rateLimits.js', () => ({
  __esModule: true,
  limiterGenericMutations: (_req, _res, next) => next(),
}));

// libphonenumber-js
await jest.unstable_mockModule('libphonenumber-js', () => {
  parsePhoneNumberFromStringMock = jest.fn((raw, _country) => {
    if (!raw) return null;
    // default: treat any non-empty input as a valid +1555... number
    return {
      isValid: () => true,
      number: '+1' + String(raw).replace(/[^\d]/g, ''),
    };
  });

  return {
    __esModule: true,
    parsePhoneNumberFromString: parsePhoneNumberFromStringMock,
  };
});

// Import router AFTER mocks
const { default: contactsImportRouter } = await import(
  '../routes/contactsImport.js'
);

// Build test app
const app = express();

// Global JSON parser (since route expects req.body already parsed)
app.use(express.json());

// Mount router at root; route path is /contacts/import
app.use(contactsImportRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// -------------------- Tests --------------------

describe('POST /contacts/import', () => {
  test('imports a new external phone contact (no matched user)', async () => {
    // No matched user
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.contact.findUnique.mockResolvedValueOnce(null); // no existing externalPhone contact
    prismaMock.contact.create.mockResolvedValueOnce({
      id: 1,
    });

    const body = {
      defaultCountry: 'US',
      contacts: [
        {
          name: 'Alice',
          alias: 'Ali',
          phones: ['(303) 555-1234'],
          emails: ['alice@example.com'],
        },
      ],
    };

    const res = await request(app)
      .post('/contacts/import')
      .set('x-test-user-id', '42')
      .send(body);

    expect(res.status).toBe(200);

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.contact.findUnique).toHaveBeenCalledTimes(1);
    expect(prismaMock.contact.create).toHaveBeenCalledTimes(1);

    // External contact create path should be used (phone present, no matched user)
    const createArg = prismaMock.contact.create.mock.calls[0][0];
    expect(createArg.data.ownerId).toBe(42);
    expect(createArg.data.externalPhone).toBeDefined();
    expect(createArg.data.externalEmail).toBe('alice@example.com');

    // Summary payload
    expect(res.body).toEqual({
      ok: true,
      added: 1,
      updated: 0,
      skippedDuplicates: 0,
      matchedUsers: 0,
      externalContacts: 1,
      invalid: 0,
    });
  });

  test('imports a matched user contact via email', async () => {
    // Matched user via email
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 777,
      username: 'aliceUser',
      email: 'alice@example.com',
    });
    // No existing contact for this savedUser
    prismaMock.contact.findUnique.mockResolvedValueOnce(null);
    prismaMock.contact.create.mockResolvedValueOnce({
      id: 2,
    });

    const body = {
      contacts: [
        {
          name: 'Alice',
          alias: 'Alice S',
          emails: ['alice@example.com'],
        },
      ],
    };

    const res = await request(app)
      .post('/contacts/import')
      .set('x-test-user-id', '10')
      .send(body);

    expect(res.status).toBe(200);

    // Should look up user by primaryEmail
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'alice@example.com' },
    });

    // Linked-contact path
    expect(prismaMock.contact.create).toHaveBeenCalledTimes(1);
    const createArg = prismaMock.contact.create.mock.calls[0][0];
    expect(createArg.data.ownerId).toBe(10);
    expect(createArg.data.savedUserId).toBe(777);
    expect(createArg.data.alias).toBe('Alice S');

    expect(res.body).toEqual({
      ok: true,
      added: 1,
      updated: 0,
      skippedDuplicates: 0,
      matchedUsers: 1,
      externalContacts: 0,
      invalid: 0,
    });
  });

  test('counts invalid contacts when no valid phone or email', async () => {
    // For this test, treat any phone as invalid by returning null from parser
    parsePhoneNumberFromStringMock.mockImplementationOnce(() => null);

    const body = {
      contacts: [
        {
          name: 'Bad Contact',
          phones: ['not-a-phone'],
          emails: [], // no emails
        },
      ],
    };

    const res = await request(app)
      .post('/contacts/import')
      .set('x-test-user-id', '5')
      .send(body);

    expect(res.status).toBe(200);

    // No DB calls, because invalid path should early-continue
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
    expect(prismaMock.contact.update).not.toHaveBeenCalled();

    expect(res.body).toEqual({
      ok: true,
      added: 0,
      updated: 0,
      skippedDuplicates: 0,
      matchedUsers: 0,
      externalContacts: 0,
      invalid: 1,
    });
  });

  test('deduplicates incoming contacts and increments skippedDuplicates', async () => {
    // No matched user for either contact
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.contact.findUnique.mockResolvedValue(null);
    prismaMock.contact.create.mockResolvedValue({ id: 3 });

    const body = {
      contacts: [
        {
          name: 'Bob',
          phones: [], // no phone
          emails: ['bob@example.com'],
        },
        {
          name: 'Bob Duplicate',
          phones: [], // no phone
          emails: ['bob@example.com'], // same primaryEmail → same dedupe key
        },
      ],
    };

    const res = await request(app)
      .post('/contacts/import')
      .set('x-test-user-id', '3')
      .send(body);

    expect(res.status).toBe(200);

    // Only one create, second deduped
    expect(prismaMock.contact.create).toHaveBeenCalledTimes(1);

    expect(res.body).toEqual({
      ok: true,
      added: 1,
      updated: 0,
      skippedDuplicates: 1,
      matchedUsers: 0,
      externalContacts: 1,
      invalid: 0,
    });
  });
});
