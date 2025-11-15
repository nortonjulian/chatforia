import { jest, describe, test, expect, afterAll } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

let prismaMock;
let tokensMock;

// Mock prisma using the exact specifier used in verifyEmail.js:
//   import prisma from '../utils/prismaClient.js';
const mockPrisma = async () => {
  prismaMock = {
    user: {
      create: jest.fn(),
      update: jest.fn(),
    },
    verificationToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (ops) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops();
    }),
  };

  await jest.unstable_mockModule('../utils/prismaClient.js', () => ({
    __esModule: true,
    default: prismaMock,
  }));
};

// Mock token helpers using the exact specifier used in verifyEmail.js:
//   import { newRawToken, hashToken, verifyHash } from '../utils/tokens.js';
const mockTokens = async () => {
  tokensMock = {
    newRawToken: jest.fn(() => 'RAW_TOKEN'),
    hashToken: jest.fn(async () => 'HASHED'),
    verifyHash: jest.fn(async () => true),
  };

  await jest.unstable_mockModule('../utils/tokens.js', () => ({
    __esModule: true,
    newRawToken: tokensMock.newRawToken,
    hashToken: tokensMock.hashToken,
    verifyHash: tokensMock.verifyHash,
  }));
};

// Helper to re-import the router (so our mocks take effect)
const reloadModule = async () => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, PUBLIC_BASE_URL: 'https://app.example' };

  await mockPrisma();
  await mockTokens();

  // Path to the module under test
  return import('../verifyEmail.js');
};

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// Minimal sanity test so Jest sees at least one test
describe('verifyEmail router', () => {
  test('module exports a router', async () => {
    const mod = await reloadModule();
    expect(mod.router).toBeDefined();
    expect(typeof mod.router.use).toBe('function'); // Express router shape
  });
});
