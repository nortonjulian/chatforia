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

const ORIGINAL_ENV = { ...process.env };

let prismaMock;
let telcoAdapter;
let getProviderMock;
let searchAvailableMock;
let getRegulationsMock;
let evaluateNumberRegulatoryComplianceMock;

await jest.unstable_mockModule('../utils/prismaClient.js', () => {
  prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
    phoneNumber: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    numberReservation: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  return {
    __esModule: true,
    default: prismaMock,
  };
});

await jest.unstable_mockModule('../lib/telco/index.js', () => {
  searchAvailableMock = jest.fn();
  getRegulationsMock = jest.fn();
  getProviderMock = jest.fn();

  telcoAdapter = {
    providerName: 'twilio-adapter',
    searchAvailable: searchAvailableMock,
    getRegulations: getRegulationsMock,
    purchaseNumber: jest.fn(),
  };

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

await jest.unstable_mockModule(
  '../services/numberRegulatoryService.js',
  () => {
    evaluateNumberRegulatoryComplianceMock =
      jest.fn();

    return {
      __esModule: true,
      evaluateNumberRegulatoryCompliance:
        evaluateNumberRegulatoryComplianceMock,
    };
  }
);

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

const { default: numbersRouter } = await import('../routes/numbers.js');

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
    ENABLE_TWILIO_LIVE_SEARCH: 'true',
  };

  prismaMock.user.findUnique.mockResolvedValue({
    plan: 'FREE',
    subscriptionStatus: 'INACTIVE',
  });

  prismaMock.$transaction.mockImplementation(
    async (callback) =>
      callback({
        phoneNumber: prismaMock.phoneNumber,
      })
  );

  evaluateNumberRegulatoryComplianceMock
    .mockResolvedValue({
      allowed: true,
      decision: 'NO_REGULATION',
      requiresVerification: false,
      profile: null,
      regulation: null,
    });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

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
      orderBy: { id: 'asc' },
    });

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: 123 },
      select: {
        plan: true,
        subscriptionStatus: true,
      },
    });

    expect(res.body).toEqual({
      number: phone,
      policy: {
        mode: 'AUTO_RECYCLE',
        inactivityDays: 40,
        holdDays: 20,
        description:
          'Numbers may be recycled after inactivity on the Free plan.',
      },
    });
  });

  test('returns null number if none assigned', async () => {
    prismaMock.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/numbers/my')
      .set('x-test-user-id', '200');

    expect(res.status).toBe(200);

    expect(res.body).toEqual({
      number: null,
      policy: {
        mode: 'AUTO_RECYCLE',
        inactivityDays: 40,
        holdDays: 20,
        description:
          'Numbers may be recycled after inactivity on the Free plan.',
      },
    });
  });
});

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
      note: 'Internal/admin endpoint: Twilio-available numbers to BUY (live search).',
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

    expect(res.body).toEqual({
      numbers: [],
      provider: 'twilio-adapter',
      note: 'Internal/admin endpoint: Twilio-available numbers to BUY (live search).',
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

  test('returns 403 when Twilio live search is disabled', async () => {
    process.env.ENABLE_TWILIO_LIVE_SEARCH = 'false';

    const res = await request(app)
      .get('/numbers/available')
      .query({ areaCode: '303' })
      .set('x-test-user-id', '1');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Twilio live search is disabled on this environment.',
      hint: 'Set ENABLE_TWILIO_LIVE_SEARCH=true to enable internal tooling.',
    });

    expect(searchAvailableMock).not.toHaveBeenCalled();
  });
});

describe('GET /numbers/regulatory-requirements', () => {
  test('returns regulatory requirements for the requested market', async () => {
    const regulations = [
      {
        sid: 'RN_test',
        friendlyName: 'Australia: Local - Individual',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        requirements: {
          end_user: [
            {
              requirement_name: 'individual_info',
              fields: ['first_name', 'last_name'],
            },
          ],
          supporting_document: [
            [
              {
                requirement_name: 'proof_of_identity_info',
                accepted_documents: [
                  { type: 'government_issued_document' },
                  { type: 'passport' },
                ],
              },
            ],
          ],
        },
      },
    ];

    getRegulationsMock.mockResolvedValueOnce(regulations);

    const res = await request(app)
      .get('/numbers/regulatory-requirements')
      .query({
        country: 'au',
        numberType: 'local',
        endUserType: 'individual',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(getProviderMock).toHaveBeenCalledWith('twilio');

    expect(getRegulationsMock).toHaveBeenCalledWith({
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      includeConstraints: true,
    });

    expect(res.body).toEqual({
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requiresRegulatoryCompliance: true,
      regulations,
    });
  });

  test('returns false when no regulation applies', async () => {
    getRegulationsMock.mockResolvedValueOnce([]);

    const res = await request(app)
      .get('/numbers/regulatory-requirements')
      .query({ country: 'US' })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(getRegulationsMock).toHaveBeenCalledWith({
      country: 'US',
      numberType: 'local',
      endUserType: 'individual',
      includeConstraints: true,
    });

    expect(res.body).toEqual({
      country: 'US',
      numberType: 'local',
      endUserType: 'individual',
      requiresRegulatoryCompliance: false,
      regulations: [],
    });
  });

  test('rejects an invalid country before calling provider', async () => {
    const res = await request(app)
      .get('/numbers/regulatory-requirements')
      .query({ country: 'USA' })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'country must be a 2-letter ISO country code',
    });

    expect(getRegulationsMock).not.toHaveBeenCalled();
  });

  test('returns 400 for unsupported regulatory parameters', async () => {
    getRegulationsMock.mockRejectedValueOnce(
      new Error('Unsupported regulatory number type: satellite')
    );

    const res = await request(app)
      .get('/numbers/regulatory-requirements')
      .query({
        country: 'AU',
        numberType: 'satellite',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Unsupported regulatory number type: satellite',
    });
  });

  test('returns 503 when regulatory provider support is unavailable', async () => {
    const originalGetRegulations = telcoAdapter.getRegulations;

    delete telcoAdapter.getRegulations;

    try {
      const res = await request(app)
        .get('/numbers/regulatory-requirements')
        .query({ country: 'AU' })
        .set('x-test-user-id', '123');

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: 'Regulatory compliance provider unavailable',
      });

      expect(getRegulationsMock).not.toHaveBeenCalled();
    } finally {
      telcoAdapter.getRegulations = originalGetRegulations;
    }
  });

  test('returns 502 when Twilio regulatory lookup fails', async () => {
    getRegulationsMock.mockRejectedValueOnce(
      new Error('Twilio unavailable')
    );

    const res = await request(app)
      .get('/numbers/regulatory-requirements')
      .query({ country: 'AU' })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      error: 'Regulatory requirements lookup failed',
    });
  });
});

describe('POST /numbers/lease', () => {
  const candidate = {
    id: 70,
    e164: '+61255550123',
    status: 'AVAILABLE',
    provider: 'twilio',
    isoCountry: 'AU',
    regulatoryNumberType: 'local',
    isLeasable: true,
    isPurchasable: false,
    locality: 'Sydney',
    region: 'NSW',
    vanity: false,
  };

  test('evaluates the exact persisted candidate before assignment', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(candidate);

    prismaMock.phoneNumber.updateMany
      .mockResolvedValueOnce({
        count: 1,
      });

    prismaMock.phoneNumber.findUnique
      .mockResolvedValueOnce({
        ...candidate,
        status: 'ASSIGNED',
        assignedUserId: 123,
      });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        e164: candidate.e164,
        country: 'US',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      evaluateNumberRegulatoryComplianceMock
    ).toHaveBeenCalledWith({
      userId: 123,
      candidate,
      endUserType: 'individual',
    });

    expect(
      prismaMock.$transaction
    ).toHaveBeenCalledTimes(1);

    expect(
      prismaMock.phoneNumber.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: candidate.id,
          status: 'AVAILABLE',
          isLeasable: true,
        },
      })
    );

    expect(res.body.ok).toBe(true);
    expect(res.body.number.status).toBe(
      'ASSIGNED'
    );
  });

  test('returns structured verification state without assigning', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(candidate);

    const regulation = {
      sid: 'RN11111111111111111111111111111111',
      isoCountry: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requirements: {
        end_user: [],
      },
    };

    evaluateNumberRegulatoryComplianceMock
      .mockResolvedValueOnce({
        allowed: false,
        decision: 'VERIFICATION_REQUIRED',
        requiresVerification: true,
        profile: null,
        regulation,
      });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'VERIFICATION_REQUIRED',
      decision: 'VERIFICATION_REQUIRED',
      requiresVerification: true,
      regulation,
      profile: null,
    });

    expect(
      prismaMock.$transaction
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.phoneNumber.updateMany
    ).not.toHaveBeenCalled();
  });

  test('legacy inventory with unknown regulatory type is blocked', async () => {
    const legacyCandidate = {
      ...candidate,
      id: 71,
      regulatoryNumberType: null,
    };

    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        legacyCandidate
      );

    evaluateNumberRegulatoryComplianceMock
      .mockResolvedValueOnce({
        allowed: false,
        decision:
          'BLOCKED_UNKNOWN_NUMBER_TYPE',
        requiresVerification: false,
        profile: null,
        regulation: null,
      });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        e164: legacyCandidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body.decision).toBe(
      'BLOCKED_UNKNOWN_NUMBER_TYPE'
    );

    expect(
      prismaMock.$transaction
    ).not.toHaveBeenCalled();
  });

  test('explicit number returns unavailable when atomic claim loses race', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(candidate);

    prismaMock.phoneNumber.updateMany
      .mockResolvedValueOnce({
        count: 0,
      });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error:
        'That number is no longer available.',
    });

    expect(
      prismaMock.phoneNumber.findUnique
    ).not.toHaveBeenCalled();
  });

  test('filter-based assignment retries a different candidate after race loss', async () => {
    const first = {
      ...candidate,
      id: 80,
      e164: '+13035550180',
      isoCountry: 'US',
      regulatoryNumberType: 'local',
    };

    const second = {
      ...candidate,
      id: 81,
      e164: '+13035550181',
      isoCountry: 'US',
      regulatoryNumberType: 'local',
    };

    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    prismaMock.phoneNumber.updateMany
      .mockResolvedValueOnce({
        count: 0,
      })
      .mockResolvedValueOnce({
        count: 1,
      });

    prismaMock.phoneNumber.findUnique
      .mockResolvedValueOnce({
        ...second,
        status: 'ASSIGNED',
        assignedUserId: 123,
      });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        country: 'US',
        areaCode: '303',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      evaluateNumberRegulatoryComplianceMock
    ).toHaveBeenCalledTimes(2);

    expect(
      prismaMock.$transaction
    ).toHaveBeenCalledTimes(2);

    const candidateQueries =
      prismaMock.phoneNumber.findFirst.mock.calls;

    expect(
      candidateQueries[2][0].where.id
    ).toEqual({
      notIn: [80],
    });

    expect(res.body.number.id).toBe(81);
  });

  test('premium purchase intent remains premium-gated', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
    });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        e164: candidate.e164,
        purchaseIntent: true,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(403);

    expect(res.body).toEqual({
      error:
        'Premium required to purchase this number',
    });

    expect(
      evaluateNumberRegulatoryComplianceMock
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$transaction
    ).not.toHaveBeenCalled();
  });

  test('existing assignment still prevents another lease', async () => {
    const existing = {
      id: 90,
      e164: '+13035550190',
      status: 'ASSIGNED',
      assignedUserId: 123,
    };

    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(existing);

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        country: 'US',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'User already has a number',
      number: existing,
    });

    expect(
      evaluateNumberRegulatoryComplianceMock
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.$transaction
    ).not.toHaveBeenCalled();
  });
});

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
      source: 'TWILIO_SEARCH',
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
      data: {
        e164,
        provider: 'twilio-adapter',
        status: 'RESERVED',
        source: 'TWILIO_SEARCH',
      },
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
      source: 'TWILIO_SEARCH',
    });

    prismaMock.numberReservation.create.mockResolvedValueOnce({ id: 2 });

    const res = await request(app)
      .post('/numbers/reserve')
      .send({ e164 })
      .set('x-test-user-id', '555');

    expect(res.status).toBe(200);

    expect(prismaMock.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: {
        status: 'RESERVED',
        provider: 'twilio-adapter',
        source: 'TWILIO_SEARCH',
      },
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
      source: 'TWILIO_SEARCH',
    });

    prismaMock.numberReservation.create.mockRejectedValueOnce(
      new Error('DB failure')
    );

    const res = await request(app)
      .post('/numbers/reserve')
      .send({ e164 })
      .set('x-test-user-id', '111');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Reserve failed' });
  });
});

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
      data: {
        keepLocked: true,
        status: 'ASSIGNED',
        holdUntil: null,
      },
    });
  });
});

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