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
let initializeNumberRegulatoryVerificationMock;
let getRegulatorySupportingDocumentFieldRequirementsMock;
let provisionRegulatorySupportingDocumentMock;
let assembleRegulatoryBundleMock;
let submitNumberRegulatoryBundleMock;

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
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    $executeRaw: jest.fn(),
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

    initializeNumberRegulatoryVerificationMock =
      jest.fn();

    getRegulatorySupportingDocumentFieldRequirementsMock =
      jest.fn();

    provisionRegulatorySupportingDocumentMock =
      jest.fn();

    assembleRegulatoryBundleMock =
      jest.fn();

    submitNumberRegulatoryBundleMock =
      jest.fn();

    return {
      __esModule: true,
      evaluateNumberRegulatoryCompliance:
        evaluateNumberRegulatoryComplianceMock,
      initializeNumberRegulatoryVerification:
        initializeNumberRegulatoryVerificationMock,
      getRegulatorySupportingDocumentFieldRequirements:
        getRegulatorySupportingDocumentFieldRequirementsMock,
      provisionRegulatorySupportingDocument:
        provisionRegulatorySupportingDocumentMock,
      assembleRegulatoryBundle:
        assembleRegulatoryBundleMock,
      submitNumberRegulatoryBundle:
        submitNumberRegulatoryBundleMock,
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
    TWILIO_WEBHOOK_BASE_URL:
      'https://api.chatforia.com/api',
  };

  prismaMock.user.findUnique.mockResolvedValue({
    plan: 'FREE',
    subscriptionStatus: 'INACTIVE',
  });

  prismaMock.$transaction.mockImplementation(
    async (callback) =>
      callback({
        phoneNumber: prismaMock.phoneNumber,
        numberReservation:
          prismaMock.numberReservation,
        $executeRaw: prismaMock.$executeRaw,
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

  test('explicit lease rejects a number held for another users regulatory verification', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 40,
        phoneNumberId: candidate.id,
        userId: 999,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    const res = await request(app)
      .post('/numbers/lease')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'NUMBER_REGULATORY_RESERVED',
      decision: 'NUMBER_REGULATORY_RESERVED',
    });

    expect(
      prismaMock.phoneNumber.updateMany
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.numberReservation.deleteMany
    ).not.toHaveBeenCalled();
  });

  test('regulatory reservation owner can lease and consumes the hold', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 41,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    prismaMock.phoneNumber.updateMany
      .mockResolvedValueOnce({
        count: 1,
      });

    prismaMock.numberReservation.deleteMany
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
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.numberReservation.deleteMany
    ).toHaveBeenCalledWith({
      where: {
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
      },
    });

    expect(res.body.number).toEqual(
      expect.objectContaining({
        id: candidate.id,
        status: 'ASSIGNED',
        assignedUserId: 123,
      })
    );
  });

  test('expired regulatory reservation does not block leasing', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce(null);

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
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.numberReservation.findFirst
    ).toHaveBeenCalledWith({
      where: {
        phoneNumberId: candidate.id,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: {
          gt: expect.any(Date),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(
      prismaMock.numberReservation.deleteMany
    ).not.toHaveBeenCalled();
  });

  test('filter lease skips another users regulatory hold and leases the next candidate', async () => {
    const first = {
      ...candidate,
      id: 82,
      e164: '+13035550182',
      isoCountry: 'US',
      regulatoryNumberType: 'local',
    };

    const second = {
      ...candidate,
      id: 83,
      e164: '+13035550183',
      isoCountry: 'US',
      regulatoryNumberType: 'local',
    };

    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 42,
        phoneNumberId: first.id,
        userId: 999,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      })
      .mockResolvedValueOnce(null);

    prismaMock.phoneNumber.updateMany
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
      prismaMock.phoneNumber.updateMany
    ).toHaveBeenCalledTimes(1);

    expect(
      prismaMock.phoneNumber.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: second.id,
        }),
      })
    );

    const candidateQueries =
      prismaMock.phoneNumber.findFirst.mock.calls;

    expect(
      candidateQueries[2][0].where.id
    ).toEqual({
      notIn: [first.id],
    });

    expect(res.body.number.id).toBe(second.id);
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
describe('POST /numbers/regulatory/initialize', () => {
  const candidate = {
    id: 170,
    e164: '+61255550170',
    status: 'AVAILABLE',
    provider: 'twilio',
    isoCountry: 'AU',
    regulatoryNumberType: 'local',
    isLeasable: true,
    isPurchasable: false,
  };

  test('initializes verification from the exact persisted candidate', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      initialized: true,
      reused: false,
      reason: null,
      profile: {
        id: 10,
        userId: 123,
        provider: 'twilio',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        status: 'NOT_STARTED',
      },
      regulation: {
        sid: 'RN11111111111111111111111111111111',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
      },
      requirements: {
        end_user: [],
      },
    };

    initializeNumberRegulatoryVerificationMock
      .mockResolvedValueOnce(result);

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,

        // These must not control regulatory identity.
        country: 'US',
        numberType: 'mobile',
        provider: 'other',

        endUserAttributes: {
          first_name: 'Test',
          last_name: 'User',
        },
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.phoneNumber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        e164: candidate.e164,
        status: 'AVAILABLE',
        isLeasable: true,
      },
    });

    expect(
      initializeNumberRegulatoryVerificationMock
    ).toHaveBeenCalledWith({
      userId: 123,
      candidate,
      endUserType: 'individual',
      endUserAttributes: {
        first_name: 'Test',
        last_name: 'User',
      },
    });

    expect(res.body).toEqual(result);
  });

  test('creates a regulatory reservation for an unheld exact candidate', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce(null);

    prismaMock.numberReservation.create
      .mockResolvedValueOnce({
        id: 30,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 60 * 60 * 1000
        ),
      });

    initializeNumberRegulatoryVerificationMock
      .mockResolvedValueOnce({
        initialized: true,
        reused: false,
        reason: null,
        profile: { id: 10 },
        regulation: {
          sid: 'RN11111111111111111111111111111111',
        },
        requirements: {
          end_user: [],
        },
      });

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.$executeRaw
    ).toHaveBeenCalledTimes(1);

    expect(
      prismaMock.numberReservation.findFirst
    ).toHaveBeenCalledWith({
      where: {
        phoneNumberId: candidate.id,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: {
          gt: expect.any(Date),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(
      prismaMock.numberReservation.create
    ).toHaveBeenCalledWith({
      data: {
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: expect.any(Date),
      },
    });

    expect(
      prismaMock.numberReservation.update
    ).not.toHaveBeenCalled();
  });

  test('renews the same users active regulatory reservation', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 31,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    prismaMock.numberReservation.update
      .mockResolvedValueOnce({
        id: 31,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 60 * 60 * 1000
        ),
      });

    initializeNumberRegulatoryVerificationMock
      .mockResolvedValueOnce({
        initialized: true,
        reused: true,
        reason: null,
        profile: { id: 10 },
        regulation: {
          sid: 'RN11111111111111111111111111111111',
        },
        requirements: {
          end_user: [],
        },
      });

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.numberReservation.update
    ).toHaveBeenCalledWith({
      where: {
        id: 31,
      },
      data: {
        expiresAt: expect.any(Date),
      },
    });

    expect(
      prismaMock.numberReservation.create
    ).not.toHaveBeenCalled();
  });

  test('rejects regulatory initialization when another user holds the number', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 32,
        phoneNumberId: candidate.id,
        userId: 999,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'NUMBER_REGULATORY_RESERVED',
      decision: 'NUMBER_REGULATORY_RESERVED',
    });

    expect(
      prismaMock.numberReservation.create
    ).not.toHaveBeenCalled();

    expect(
      prismaMock.numberReservation.update
    ).not.toHaveBeenCalled();

    expect(
      initializeNumberRegulatoryVerificationMock
    ).not.toHaveBeenCalled();
  });

  test('requires an E.164 number', async () => {
    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error: 'e164 required',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      initializeNumberRegulatoryVerificationMock
    ).not.toHaveBeenCalled();
  });

  test('rejects a number that is not available inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error: 'Number not available',
    });

    expect(
      initializeNumberRegulatoryVerificationMock
    ).not.toHaveBeenCalled();
  });

  test('fails closed when persisted regulatory type is unknown', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce({
        ...candidate,
        regulatoryNumberType: null,
      });

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
    });

    expect(
      initializeNumberRegulatoryVerificationMock
    ).not.toHaveBeenCalled();
  });

  test('returns structured service failure without exposing provider errors', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    initializeNumberRegulatoryVerificationMock
      .mockResolvedValueOnce({
        initialized: false,
        reused: false,
        reason: 'missing-end-user-fields',
        profile: {
          id: 10,
        },
        regulation: {
          sid: 'RN11111111111111111111111111111111',
        },
        requirements: {
          end_user: [
            {
              fields: [
                'first_name',
                'last_name',
              ],
            },
          ],
        },
        validation: {
          valid: false,
          requiredFields: [
            'first_name',
            'last_name',
          ],
          missingFields: [
            'last_name',
          ],
          attributes: {
            first_name: 'Test',
          },
        },
      });

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
        endUserAttributes: {
          first_name: 'Test',
        },
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);
    expect(res.body.initialized).toBe(false);
    expect(res.body.reason).toBe(
      'missing-end-user-fields'
    );
    expect(res.body.validation.missingFields)
      .toEqual(['last_name']);
  });

  test('returns a generic server error if initialization throws', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    initializeNumberRegulatoryVerificationMock
      .mockRejectedValueOnce(
        new Error('sensitive provider error')
      );

    const res = await request(app)
      .post('/numbers/regulatory/initialize')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(502);

    expect(res.body).toEqual({
      error:
        'Regulatory verification initialization failed',
    });

    expect(
      JSON.stringify(res.body)
    ).not.toContain(
      'sensitive provider error'
    );
  });
});

describe('POST /numbers/regulatory/document-requirements', () => {
  const candidate = {
    id: 170,
    e164: '+61255550170',
    status: 'AVAILABLE',
    provider: 'twilio',
    isoCountry: 'AU',
    regulatoryNumberType: 'local',
    isLeasable: true,
    isPurchasable: false,
  };

  const requirementName = 'proof_of_identity_info';
  const documentType = 'passport';

  test('returns dynamic fields using regulatory identity from persisted inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      resolved: true,
      reason: null,
      requirementName,
      documentType,
      requiredFields: [
        'document_number',
        'document_issuing_country',
      ],
    };

    getRegulatorySupportingDocumentFieldRequirementsMock
      .mockResolvedValueOnce(result);

    const res = await request(app)
      .post(
        '/numbers/regulatory/document-requirements'
      )
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,

        // These must not control regulatory identity.
        provider: 'other',
        country: 'US',
        numberType: 'mobile',
        endUserType: 'business',
        profileId: 999,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.phoneNumber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        e164: candidate.e164,
        status: 'AVAILABLE',
        isLeasable: true,
      },
    });

    expect(
      getRegulatorySupportingDocumentFieldRequirementsMock
    ).toHaveBeenCalledWith({
      userId: 123,
      provider: 'twilio',
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requirementName,
      documentType,
    });

    expect(res.body).toEqual(result);
  });

  test('requires e164, requirementName, and documentType', async () => {
    const cases = [
      {
        body: {
          requirementName,
          documentType,
        },
        error: 'e164 required',
      },
      {
        body: {
          e164: candidate.e164,
          documentType,
        },
        error: 'requirementName required',
      },
      {
        body: {
          e164: candidate.e164,
          requirementName,
        },
        error: 'documentType required',
      },
    ];

    for (const entry of cases) {
      const res = await request(app)
        .post(
          '/numbers/regulatory/document-requirements'
        )
        .send(entry.body)
        .set('x-test-user-id', '123');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: entry.error,
      });
    }

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      getRegulatorySupportingDocumentFieldRequirementsMock
    ).not.toHaveBeenCalled();
  });

  test('rejects a number that is not available inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post(
        '/numbers/regulatory/document-requirements'
      )
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: 'Number not available',
    });

    expect(
      getRegulatorySupportingDocumentFieldRequirementsMock
    ).not.toHaveBeenCalled();
  });

  test('fails closed when persisted regulatory type is unknown', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce({
        ...candidate,
        regulatoryNumberType: null,
      });

    const res = await request(app)
      .post(
        '/numbers/regulatory/document-requirements'
      )
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
    });

    expect(
      getRegulatorySupportingDocumentFieldRequirementsMock
    ).not.toHaveBeenCalled();
  });

  test('returns a structured unresolved requirements result', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      resolved: false,
      reason:
        'unsupported-supporting-document-type',
      requirementName,
      documentType,
      requiredFields: [],
    };

    getRegulatorySupportingDocumentFieldRequirementsMock
      .mockResolvedValueOnce(result);

    const res = await request(app)
      .post(
        '/numbers/regulatory/document-requirements'
      )
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);
    expect(res.body).toEqual(result);
  });

  test('returns a generic server error if requirements lookup throws', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    getRegulatorySupportingDocumentFieldRequirementsMock
      .mockRejectedValueOnce(
        new Error('sensitive provider error')
      );

    const res = await request(app)
      .post(
        '/numbers/regulatory/document-requirements'
      )
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(502);

    expect(res.body).toEqual({
      error:
        'Regulatory document requirements lookup failed',
    });

    expect(
      JSON.stringify(res.body)
    ).not.toContain(
      'sensitive provider error'
    );
  });
});

describe('POST /numbers/regulatory/documents', () => {
  const candidate = {
    id: 171,
    e164: '+61255550171',
    status: 'AVAILABLE',
    provider: 'twilio',
    isoCountry: 'AU',
    regulatoryNumberType: 'local',
    isLeasable: true,
    isPurchasable: false,
  };

  const requirementName = 'Proof of Identity';
  const documentType = 'government-issued-id';

  test('provisions a document using regulatory identity from persisted inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      provisioned: true,
      reused: false,
      reason: null,
      document: {
        id: 20,
        profileId: 10,
        requirementName,
        documentType,
        supportingDocumentSid:
          'RD22222222222222222222222222222222',
      },
      requirement: {
        requirementName,
        type: 'document',
        acceptedDocuments: [
          {
            name: 'Government-issued ID',
            type: documentType,
          },
        ],
      },
    };

    provisionRegulatorySupportingDocumentMock
      .mockResolvedValueOnce(result);

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
        attributes: {
          document_number: 'TEST-123',
        },

        // These must not control regulatory identity.
        country: 'US',
        numberType: 'mobile',
        provider: 'other',
        profileId: 999,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.phoneNumber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        e164: candidate.e164,
        status: 'AVAILABLE',
        isLeasable: true,
      },
    });

    expect(
      provisionRegulatorySupportingDocumentMock
    ).toHaveBeenCalledWith({
      userId: 123,
      provider: 'twilio',
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requirementName,
      documentType,
      attributes: {
        document_number: 'TEST-123',
      },
      friendlyName: undefined,
      file: undefined,
    });

    expect(res.body).toEqual(result);
  });

  test('uploads a multipart regulatory document with parsed attributes', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      provisioned: true,
      reused: false,
      reason: null,
      document: {
        id: 21,
        profileId: 10,
        requirementName,
        documentType,
        supportingDocumentSid:
          'RD33333333333333333333333333333333',
      },
    };

    provisionRegulatorySupportingDocumentMock
      .mockResolvedValueOnce(result);

    const pdfBuffer = Buffer.from(
      '%PDF-1.4\nChatforia regulatory test\n'
    );

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .field('e164', candidate.e164)
      .field('requirementName', requirementName)
      .field('documentType', documentType)
      .field(
        'attributes',
        JSON.stringify({
          document_number: 'TEST-456',
          document_issuing_country: 'AU',
        })
      )
      .field(
        'friendlyName',
        'Government ID'
      )
      .attach(
        'file',
        pdfBuffer,
        {
          filename: 'identity.pdf',
          contentType: 'application/pdf',
        }
      )
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.phoneNumber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        e164: candidate.e164,
        status: 'AVAILABLE',
        isLeasable: true,
      },
    });

    expect(
      provisionRegulatorySupportingDocumentMock
    ).toHaveBeenCalledTimes(1);

    const call =
      provisionRegulatorySupportingDocumentMock
        .mock.calls[0][0];

    expect(call).toMatchObject({
      userId: 123,
      provider: 'twilio',
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      requirementName,
      documentType,
      attributes: {
        document_number: 'TEST-456',
        document_issuing_country: 'AU',
      },
      friendlyName: 'Government ID',
    });

    expect(call.file).toEqual(
      expect.objectContaining({
        fieldname: 'file',
        originalname: 'identity.pdf',
        mimetype: 'application/pdf',
        buffer: pdfBuffer,
      })
    );

    expect(res.body).toEqual(result);
  });

  test('requires a file for multipart regulatory document requests', async () => {
    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .field('e164', candidate.e164)
      .field('requirementName', requirementName)
      .field('documentType', documentType)
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'REGULATORY_DOCUMENT_FILE_REQUIRED',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('rejects malformed multipart regulatory document attributes', async () => {
    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .field('e164', candidate.e164)
      .field('requirementName', requirementName)
      .field('documentType', documentType)
      .field('attributes', '{"broken":')
      .attach(
        'file',
        Buffer.from('%PDF-1.4\ninvalid attributes\n'),
        {
          filename: 'identity.pdf',
          contentType: 'application/pdf',
        }
      )
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'INVALID_REGULATORY_DOCUMENT_ATTRIBUTES',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('rejects an unsupported regulatory document MIME type without exposing Multer details', async () => {
    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .field('e164', candidate.e164)
      .field('requirementName', requirementName)
      .field('documentType', documentType)
      .attach(
        'file',
        Buffer.from('plain text'),
        {
          filename: 'identity.txt',
          contentType: 'text/plain',
        }
      )
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'UNSUPPORTED_REGULATORY_DOCUMENT_TYPE',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('rejects an invalid regulatory document extension', async () => {
    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .field('e164', candidate.e164)
      .field('requirementName', requirementName)
      .field('documentType', documentType)
      .attach(
        'file',
        Buffer.from('%PDF-1.4\nwrong extension\n'),
        {
          filename: 'identity.txt',
          contentType: 'application/pdf',
        }
      )
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error:
        'INVALID_REGULATORY_DOCUMENT_EXTENSION',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('rejects a regulatory document larger than 5 MB', async () => {
    const oversizedBuffer =
      Buffer.alloc(
        5 * 1024 * 1024 + 1,
        0x61
      );

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .field('e164', candidate.e164)
      .field('requirementName', requirementName)
      .field('documentType', documentType)
      .attach(
        'file',
        oversizedBuffer,
        {
          filename: 'identity.pdf',
          contentType: 'application/pdf',
        }
      )
      .set('x-test-user-id', '123');

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: 'REGULATORY_DOCUMENT_TOO_LARGE',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('requires e164, requirementName, and documentType', async () => {
    const cases = [
      {
        body: {
          requirementName,
          documentType,
        },
        error: 'e164 required',
      },
      {
        body: {
          e164: candidate.e164,
          documentType,
        },
        error: 'requirementName required',
      },
      {
        body: {
          e164: candidate.e164,
          requirementName,
        },
        error: 'documentType required',
      },
    ];

    for (const entry of cases) {
      const res = await request(app)
        .post('/numbers/regulatory/documents')
        .send(entry.body)
        .set('x-test-user-id', '123');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: entry.error,
      });
    }

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('rejects a number that is not available inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error: 'Number not available',
    });

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('fails closed when persisted regulatory type is unknown', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce({
        ...candidate,
        regulatoryNumberType: null,
      });

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
    });

    expect(
      provisionRegulatorySupportingDocumentMock
    ).not.toHaveBeenCalled();
  });

  test('returns structured provisioning failure', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    provisionRegulatorySupportingDocumentMock
      .mockResolvedValueOnce({
        provisioned: false,
        reused: false,
        reason:
          'unsupported-supporting-document-type',
        document: null,
        requirement: {
          requirementName,
          acceptedDocuments: [],
        },
      });

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body.provisioned).toBe(false);
    expect(res.body.reason).toBe(
      'unsupported-supporting-document-type'
    );
  });

  test('does not expose provider errors when provisioning throws', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    provisionRegulatorySupportingDocumentMock
      .mockRejectedValueOnce(
        new Error('sensitive Twilio failure')
      );

    const res = await request(app)
      .post('/numbers/regulatory/documents')
      .send({
        e164: candidate.e164,
        requirementName,
        documentType,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(502);

    expect(res.body).toEqual({
      error:
        'Regulatory document provisioning failed',
    });

    expect(
      JSON.stringify(res.body)
    ).not.toContain(
      'sensitive Twilio failure'
    );
  });
});

describe('POST /numbers/regulatory/assemble', () => {
  const candidate = {
    id: 181,
    e164: '+61255550181',
    status: 'AVAILABLE',
    provider: 'twilio',
    isoCountry: 'AU',
    regulatoryNumberType: 'local',
    isLeasable: true,
    isPurchasable: false,
  };

  test('assembles using regulatory identity from persisted inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      assembled: true,
      reusedBundle: false,
      reason: null,
      bundleSid:
        'BU33333333333333333333333333333333',
      assignedNow: [
        'IT11111111111111111111111111111111',
      ],
      alreadyAssigned: [],
    };

    assembleRegulatoryBundleMock
      .mockResolvedValueOnce(result);

    const res = await request(app)
      .post('/numbers/regulatory/assemble')
      .send({
        e164: candidate.e164,
        email: 'user@example.com',
        friendlyName: 'My AU Bundle',

        // These must not control regulatory identity.
        provider: 'other',
        country: 'US',
        numberType: 'mobile',
        endUserType: 'business',
        profileId: 999,
        regulationSid:
          'RN99999999999999999999999999999999',
        bundleSid:
          'BU99999999999999999999999999999999',
        statusCallback:
          'https://attacker.invalid/callback',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.phoneNumber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        e164: candidate.e164,
        status: 'AVAILABLE',
        isLeasable: true,
      },
    });

    expect(
      assembleRegulatoryBundleMock
    ).toHaveBeenCalledWith({
      userId: 123,
      provider: 'twilio',
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      email: 'user@example.com',
      friendlyName: 'My AU Bundle',
      statusCallback:
        'https://api.chatforia.com/api/webhooks/twilio/regulatory-status',
    });

    expect(res.body).toEqual(result);
  });

  test('fails closed when the regulatory callback base is not configured', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const previous =
      process.env.TWILIO_WEBHOOK_BASE_URL;

    delete process.env.TWILIO_WEBHOOK_BASE_URL;

    try {
      const res = await request(app)
        .post('/numbers/regulatory/assemble')
        .send({
          e164: candidate.e164,
          email: 'user@example.com',
          statusCallback:
            'https://attacker.invalid/callback',
        })
        .set('x-test-user-id', '123');

      expect(res.status).toBe(503);

      expect(res.body).toEqual({
        error:
          'Regulatory status callback is not configured',
      });

      expect(
        assembleRegulatoryBundleMock
      ).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) {
        delete process.env
          .TWILIO_WEBHOOK_BASE_URL;
      } else {
        process.env.TWILIO_WEBHOOK_BASE_URL =
          previous;
      }
    }
  });

  test('requires e164 and email', async () => {
    const cases = [
      {
        body: {
          email: 'user@example.com',
        },
        error: 'e164 required',
      },
      {
        body: {
          e164: candidate.e164,
        },
        error: 'email required',
      },
    ];

    for (const entry of cases) {
      const res = await request(app)
        .post('/numbers/regulatory/assemble')
        .send(entry.body)
        .set('x-test-user-id', '123');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: entry.error,
      });
    }

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      assembleRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('rejects a number that is not available inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/regulatory/assemble')
      .send({
        e164: candidate.e164,
        email: 'user@example.com',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error: 'Number not available',
    });

    expect(
      assembleRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('fails closed when persisted regulatory type is unknown', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce({
        ...candidate,
        regulatoryNumberType: null,
      });

    const res = await request(app)
      .post('/numbers/regulatory/assemble')
      .send({
        e164: candidate.e164,
        email: 'user@example.com',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
    });

    expect(
      assembleRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('returns structured incomplete assembly state', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    assembleRegulatoryBundleMock
      .mockResolvedValueOnce({
        assembled: false,
        reusedBundle: false,
        reason: 'supporting-documents-incomplete',
        missingRequirementNames: [
          'proof_of_address_info',
        ],
      });

    const res = await request(app)
      .post('/numbers/regulatory/assemble')
      .send({
        e164: candidate.e164,
        email: 'user@example.com',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);
    expect(res.body.assembled).toBe(false);
    expect(res.body.reason).toBe(
      'supporting-documents-incomplete'
    );
  });

  test('does not expose provider errors when assembly throws', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    assembleRegulatoryBundleMock
      .mockRejectedValueOnce(
        new Error('sensitive Twilio failure')
      );

    const res = await request(app)
      .post('/numbers/regulatory/assemble')
      .send({
        e164: candidate.e164,
        email: 'user@example.com',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(502);

    expect(res.body).toEqual({
      error: 'Regulatory Bundle assembly failed',
    });

    expect(
      JSON.stringify(res.body)
    ).not.toContain(
      'sensitive Twilio failure'
    );
  });
});

describe('POST /numbers/regulatory/submit', () => {
  const candidate = {
    id: 191,
    e164: '+61255550191',
    status: 'AVAILABLE',
    provider: 'twilio',
    isoCountry: 'AU',
    regulatoryNumberType: 'local',
    isLeasable: true,
    isPurchasable: false,
  };

  test('submits using regulatory identity from persisted inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    const result = {
      submitted: true,
      reason: null,
      profile: {
        id: 10,
        userId: 123,
        provider: 'twilio',
        isoCountry: 'AU',
        numberType: 'local',
        endUserType: 'individual',
        status: 'PENDING_REVIEW',
        providerStatus: 'pending-review',
      },
    };

    submitNumberRegulatoryBundleMock
      .mockResolvedValueOnce(result);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 50,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    prismaMock.numberReservation.update
      .mockResolvedValueOnce({
        id: 50,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ),
      });

    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({
        e164: candidate.e164,

        // These must not control regulatory identity.
        provider: 'other',
        country: 'US',
        numberType: 'mobile',
        endUserType: 'business',
        profileId: 999,
        regulationSid:
          'RN99999999999999999999999999999999',
        bundleSid:
          'BU99999999999999999999999999999999',
        status: 'twilio-approved',
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(200);

    expect(
      prismaMock.phoneNumber.findFirst
    ).toHaveBeenCalledWith({
      where: {
        e164: candidate.e164,
        status: 'AVAILABLE',
        isLeasable: true,
      },
    });

    expect(
      submitNumberRegulatoryBundleMock
    ).toHaveBeenCalledWith({
      userId: 123,
      provider: 'twilio',
      country: 'AU',
      numberType: 'local',
      endUserType: 'individual',
    });

    expect(
      prismaMock.numberReservation.findFirst
    ).toHaveBeenCalledWith({
      where: {
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: {
          gt: expect.any(Date),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(
      prismaMock.numberReservation.update
    ).toHaveBeenCalledWith({
      where: {
        id: 50,
      },
      data: {
        expiresAt: expect.any(Date),
      },
    });

    expect(res.body).toEqual(result);
  });

  test('fails closed when the regulatory reservation expired before submission completed', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error:
        'REGULATORY_RESERVATION_EXPIRED',
      decision:
        'REGULATORY_RESERVATION_EXPIRED',
    });

    expect(
      prismaMock.numberReservation.update
    ).not.toHaveBeenCalled();

    expect(
      submitNumberRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('requires e164', async () => {
    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({})
      .set('x-test-user-id', '123');

    expect(res.status).toBe(400);

    expect(res.body).toEqual({
      error: 'e164 required',
    });

    expect(
      prismaMock.phoneNumber.findFirst
    ).not.toHaveBeenCalled();

    expect(
      submitNumberRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('rejects a number that is not available inventory', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(404);

    expect(res.body).toEqual({
      error: 'Number not available',
    });

    expect(
      submitNumberRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('fails closed when persisted regulatory type is unknown', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce({
        ...candidate,
        regulatoryNumberType: null,
      });

    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);

    expect(res.body).toEqual({
      error: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
      decision: 'BLOCKED_UNKNOWN_NUMBER_TYPE',
    });

    expect(
      submitNumberRegulatoryBundleMock
    ).not.toHaveBeenCalled();
  });

  test('returns structured submission failure', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 51,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    prismaMock.numberReservation.update
      .mockResolvedValueOnce({
        id: 51,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ),
      });

    submitNumberRegulatoryBundleMock
      .mockResolvedValueOnce({
        submitted: false,
        reason: 'bundle-incomplete',
        missingObjectSids: [
          'RD55555555555555555555555555555555',
        ],
      });

    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(409);
    expect(res.body.submitted).toBe(false);
    expect(res.body.reason).toBe(
      'bundle-incomplete'
    );
  });

  test('does not expose provider errors when submission throws', async () => {
    prismaMock.phoneNumber.findFirst
      .mockResolvedValueOnce(candidate);

    prismaMock.numberReservation.findFirst
      .mockResolvedValueOnce({
        id: 52,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 30 * 60 * 1000
        ),
        createdAt: new Date(),
      });

    prismaMock.numberReservation.update
      .mockResolvedValueOnce({
        id: 52,
        phoneNumberId: candidate.id,
        userId: 123,
        purpose: 'REGULATORY_VERIFICATION',
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ),
      });

    submitNumberRegulatoryBundleMock
      .mockRejectedValueOnce(
        new Error('sensitive Twilio failure')
      );

    const res = await request(app)
      .post('/numbers/regulatory/submit')
      .send({
        e164: candidate.e164,
      })
      .set('x-test-user-id', '123');

    expect(res.status).toBe(502);

    expect(res.body).toEqual({
      error:
        'Regulatory Bundle submission failed',
    });

    expect(
      JSON.stringify(res.body)
    ).not.toContain(
      'sensitive Twilio failure'
    );
  });
});
