import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';

// --- Service mocks -----------------------------------------------------------

const mockGetForwardingPrefs = jest.fn();
const mockUpdateForwardingPrefs = jest.fn();

jest.unstable_mockModule('../services/forwardingService.js', () => ({
  __esModule: true,
  getForwardingPrefs: mockGetForwardingPrefs,
  updateForwardingPrefs: mockUpdateForwardingPrefs,
}));

// --- asyncHandler mock -------------------------------------------------------

jest.unstable_mockModule('../utils/asyncHandler.js', () => ({
  __esModule: true,
  // Just pass the handler through; Jest will still see async errors
  asyncHandler: (fn) => fn,
}));

// --- auth mock ---------------------------------------------------------------

jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, res, next) => next(),
}));

// Import router AFTER mocks
const { default: forwardingRouter } = await import('../routes/settings.forwarding.js');

// --- Helper: build app -------------------------------------------------------

function createApp({ user } = {}) {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    // Inject a default user so requireAuth passes
    if (user) {
      req.user = user;
    } else {
      req.user = { id: 123 };
    }
    next();
  });

  app.use('/settings', forwardingRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetForwardingPrefs.mockReset();
  mockUpdateForwardingPrefs.mockReset();
});

// --- Tests -------------------------------------------------------------------

describe('GET /settings/forwarding', () => {
  it('returns forwarding prefs for the authenticated user', async () => {
    const user = { id: 42 };
    const app = createApp({ user });

    const prefs = {
      enabled: true,
      smsOnly: false,
      destinations: ['+15550001111', '+15550002222'],
    };

    mockGetForwardingPrefs.mockResolvedValueOnce(prefs);

    const res = await request(app).get('/settings/forwarding');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(prefs);

    expect(mockGetForwardingPrefs).toHaveBeenCalledTimes(1);
    expect(mockGetForwardingPrefs).toHaveBeenCalledWith(42);
  });
});

describe('PATCH /settings/forwarding', () => {
  it('updates forwarding prefs for the authenticated user and returns the new prefs', async () => {
    const user = { id: 99 };
    const app = createApp({ user });

    const incoming = {
      enabled: true,
      smsOnly: true,
      destinations: ['+15550003333'],
    };

    const updated = {
      enabled: true,
      smsOnly: true,
      destinations: ['+15550003333'],
      lastUpdatedAt: '2025-01-01T00:00:00.000Z',
    };

    mockUpdateForwardingPrefs.mockResolvedValueOnce(updated);

    const res = await request(app)
      .patch('/settings/forwarding')
      .send(incoming);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(updated);

    expect(mockUpdateForwardingPrefs).toHaveBeenCalledTimes(1);
    expect(mockUpdateForwardingPrefs).toHaveBeenCalledWith(99, incoming);
  });

  it('passes an empty object when body is missing and still returns prefs', async () => {
    const user = { id: 77 };
    const app = createApp({ user });

    const updated = {
      enabled: false,
      smsOnly: false,
      destinations: [],
    };

    mockUpdateForwardingPrefs.mockResolvedValueOnce(updated);

    // No .send() body → req.body should be {}
    const res = await request(app).patch('/settings/forwarding');

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(updated);

    expect(mockUpdateForwardingPrefs).toHaveBeenCalledTimes(1);
    expect(mockUpdateForwardingPrefs).toHaveBeenCalledWith(77, {});
  });
});
