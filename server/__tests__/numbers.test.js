import {
  jest,
  describe,
  test,
  expect,
  beforeEach,
  afterAll,
} from '@jest/globals';
import request from 'supertest';
import express from 'express';

const ORIGINAL_ENV = process.env;

let prismaMock;
let telcoAdapter;
let getProviderMock;
let searchAvailableMock;

// ---- Mock prisma client ----
await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    phoneNumber: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    numberReservation: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

// ---- Mock telco/index.js (Twilio adapter) ----
await jest.unstable_mockModule('../lib/telco/index.js', () => {
  searchAvailableMock = jest.fn();
  getProviderMock = jest.fn();

  telcoAdapter = {
    providerName: 'twilio-adapter',
    searchAvailable: searchAvailableMock,
  };

  // getProvider('twilio') should return this adapter
  getProviderMock.mockImplementation((key) => {
    if (key === 'twilio') return telcoAdapter;
    return null;
  });

  return {
    __esModule: true,
    default: telcoAdapter,
    getProvider: getProviderMock,
    providerName: 'twilio-adapter',
  };
});

// ---- Mock requireAuth / requirePremium ----
await jest.unstable_mockModule('../middleware/auth.js', () => ({
  __esModule: true,
  requireAuth: (req, _res, next) => {
    const id = Number(req.headers['x-test-user-id'] || '123');
    const role = req.headers['x-test-role'] || 'USER';
    req.user = { id, role };
    next();
  },
}));

await jest.unstable_mockModule('../middleware/requirePremium.js', () => ({
  __esModule: true,
  requirePremium: (_req, _res, next) => next(),
}));

// ---- Import router AFTER mocks ----
const { default: numbersRouter } = await import('../routes/numbers.js');

// ---- Build test app ----
const app = express();
app.use(express.json());
app.use('/numbers', numbersRouter);

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    NUMBER_INACTIVITY_DAYS: '40',
    NUMBER_HOLD_DAYS: '20',
    RESERVATION_MINUTES: '10',
  };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ---------------------------------------------------------------------------
// GET /numbers/my
// ---------------------------------------------------------------------------
describe('GET /numbers/my', () => {
  test('returns current number and policy when assigned', async () => {
    const phone = {
      id: 1,
      e164: '+13035550123',
      status: 'ASSIGNED',
      assignedUserId: 123,
    };
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce(phone);

    const res = await request(app)
      .get('/numbers/my')
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);
    expect(prismaMock.phoneNumber.findFirst).toHaveBeenCalledWith({
      where: {
        assignedUserId: 123,
        status: { in: ['ASSIGNED', 'HOLD'] },
      },
    });

    expect(res.body).toEqual({
      number: phone,
      policy: {
        inactivityDays: 40,
        holdDays: 20,
      },
    });
  });

  test('returns null number if none assigned', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/numbers/my')
      .set('x-test-user-id', '200');

    expect(res.status).toBe(200);
    expect(res.body.number).toBeNull();
    expect(res.body.policy).toEqual({
      inactivityDays: 40,
      holdDays: 20,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /numbers/available
// ---------------------------------------------------------------------------
describe('GET /numbers/available', () => {
  test('uses Twilio provider and returns available numbers', async () => {
    searchAvailableMock.mockResolvedValueOnce({
      items: ['+13035550111', '+13035550112'],
    });

    const res = await request(app)
      .get('/numbers/available')
      .query({ areaCode: '303', limit: '5', country: 'US', type: 'local' })
      .set('x-test-user-id', '1');

    expect(res.status).toBe(200);

    // resolveTwilioProvider should call getProvider('twilio')
    expect(getProviderMock).toHaveBeenCalledWith('twilio');

    expect(searchAvailableMock).toHaveBeenCalledWith({
      areaCode: '303',
      country: 'US',
      type: 'local',
      limit: 5,
    });

    expect(res.body).toEqual({
      numbers: ['+13035550111', '+13035550112'],
      provider: 'twilio-adapter',
    });
  });

  test('applies defaults for limit/country/type', async () => {
    searchAvailableMock.mockResolvedValueOnce({ items: [] });

    const res = await request(app)
      .get('/numbers/available')
      .query({ areaCode: '720' })
      .set('x-test-user-id', '1');

    expect(res.status).toBe(200);
    expect(searchAvailableMock).toHaveBeenCalledWith({
      areaCode: '720',
      country: 'US',
      type: 'local',
      limit: 20,
    });
  });

  test('returns 502 when provider search fails', async () => {
    searchAvailableMock.mockRejectedValueOnce(new Error('twilio down'));

    const res = await request(app)
      .get('/numbers/available')
      .query({ areaCode: '303' })
      .set('x-test-user-id', '1');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Number search failed' });
  });
});

// ---------------------------------------------------------------------------
// POST /numbers/reserve
// ---------------------------------------------------------------------------
describe('POST /numbers/reserve', () => {
  test('400 when e164 missing', async () => {
    const res = await request(app)
      .post('/numbers/reserve')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'e164 required' });
    expect(prismaMock.phoneNumber.findUnique).not.toHaveBeenCalled();
  });

  test('creates shadow record when phone does not exist', async () => {
    const e164 = '+13035550123';

    prismaMock.phoneNumber.findUnique.mockResolvedValueOnce(null);
    prismaMock.phoneNumber.create.mockResolvedValueOnce({
      id: 10,
      e164,
      status: 'RESERVED',
      provider: 'twilio-adapter',
    });
    prismaMock.numberReservation.create.mockResolvedValueOnce({ id: 1 });

    const res = await request(app)
      .post('/numbers/reserve')
      .send({ e164 })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.provider).toBe('twilio-adapter');
    expect(res.body.expiresAt).toBeDefined();

    expect(prismaMock.phoneNumber.findUnique).toHaveBeenCalledWith({
      where: { e164 },
    });

    expect(prismaMock.phoneNumber.create).toHaveBeenCalledWith({
      data: { e164, provider: 'twilio-adapter', status: 'RESERVED' },
    });

    expect(prismaMock.numberReservation.create).toHaveBeenCalledTimes(1);
    const reservationArgs = prismaMock.numberReservation.create.mock.calls[0][0];
    expect(reservationArgs.data.phoneNumberId).toBe(10);
    expect(reservationArgs.data.userId).toBe(123);
    expect(reservationArgs.data.expiresAt).toBeInstanceOf(Date);
  });

  test('updates existing AVAILABLE phone and reserves it', async () => {
    const e164 = '+13035550124';

    prismaMock.phoneNumber.findUnique.mockResolvedValueOnce({
      id: 20,
      e164,
      status: 'AVAILABLE',
      provider: 'twilio-adapter',
    });

    prismaMock.phoneNumber.update.mockResolvedValueOnce({
      id: 20,
      e164,
      status: 'RESERVED',
      provider: 'twilio-adapter',
    });

    prismaMock.numberReservation.create.mockResolvedValueOnce({ id: 2 });

    const res = await request(app)
      .post('/numbers/reserve')
      .send({ e164 })
      .set('x-test-user-id', '555');

    expect(res.status).toBe(200);
    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { status: 'RESERVED', provider: 'twilio-adapter' },
    });

    const reservationArgs = prismaMock.numberReservation.create.mock.calls[0][0];
    expect(reservationArgs.data.phoneNumberId).toBe(20);
    expect(reservationArgs.data.userId).toBe(555);
  });

  test('returns 409 when phone status not AVAILABLE or RESERVED', async () => {
    const e164 = '+13035550125';

    prismaMock.phoneNumber.findUnique.mockResolvedValueOnce({
      id: 30,
      e164,
      status: 'ASSIGNED',
      provider: 'twilio-adapter',
    });

    const res = await request(app)
      .post('/numbers/reserve')
      .send({ e164 })
      .set('x-test-user-id', '999');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Number not available' });
    expect(prismaMock.phoneNumber.update).not.toHaveBeenCalled();
    expect(prismaMock.numberReservation.create).not.toHaveBeenCalled();
  });

  test('500 when reservation insert fails', async () => {
    const e164 = '+13035550126';

    prismaMock.phoneNumber.findUnique.mockResolvedValueOnce(null);
    prismaMock.phoneNumber.create.mockResolvedValueOnce({
      id: 40,
      e164,
      status: 'RESERVED',
      provider: 'twilio-adapter',
    });
    prismaMock.numberReservation.create.mockRejectedValueOnce(
      new Error('DB failure'),
    );

    const res = await request(app)
      .post('/numbers/reserve')
      .send({ e164 })
      .set('x-test-user-id', '111');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Reserve failed' });
  });
});

// ---------------------------------------------------------------------------
// POST /numbers/keep/enable
// ---------------------------------------------------------------------------
describe('POST /numbers/keep/enable', () => {
  test('404 when user has no number', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/keep/enable')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No number' });
  });

  test('sets keepLocked true when number exists', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce({
      id: 50,
      e164: '+13035550127',
      status: 'ASSIGNED',
      assignedUserId: 123,
    });

    prismaMock.phoneNumber.update.mockResolvedValueOnce({ id: 50 });

    const res = await request(app)
      .post('/numbers/keep/enable')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { keepLocked: true },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /numbers/keep/disable
// ---------------------------------------------------------------------------
describe('POST /numbers/keep/disable', () => {
  test('404 when user has no number', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/keep/disable')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'No number' });
  });

  test('sets keepLocked false when number exists', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce({
      id: 60,
      e164: '+13035550128',
      status: 'ASSIGNED',
      assignedUserId: 123,
    });

    prismaMock.phoneNumber.update.mockResolvedValueOnce({ id: 60 });

    const res = await request(app)
      .post('/numbers/keep/disable')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 60 },
      data: { keepLocked: false },
    });
  });
});
