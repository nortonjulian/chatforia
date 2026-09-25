/**
 * @jest-environment node
 */

import { jest } from '@jest/globals';

process.env.TWILIO_ACCOUNT_SID = 'AC_test';
process.env.TWILIO_AUTH_TOKEN = 'auth_test';

const endUserCreateMock = jest.fn();
const bundleCreateMock = jest.fn();
const itemAssignmentCreateMock = jest.fn();
const itemAssignmentListMock = jest.fn();
const bundleFetchMock = jest.fn();
const bundleUpdateMock = jest.fn();
const supportingDocumentTypeListMock = jest.fn();
const supportingDocumentCreateMock = jest.fn();

const bundleContextMock = jest.fn(() => ({
  itemAssignments: {
    create: itemAssignmentCreateMock,
    list: itemAssignmentListMock,
  },
  fetch: bundleFetchMock,
  update: bundleUpdateMock,
}));

await jest.unstable_mockModule('twilio', () => {
  const factory = () => ({
    numbers: {
      v2: {
        regulatoryCompliance: {
          endUsers: {
            create: endUserCreateMock,
          },
          bundles: Object.assign(
            bundleContextMock,
            {
              create: bundleCreateMock,
            }
          ),
          supportingDocumentTypes: {
            list: supportingDocumentTypeListMock,
          },
          supportingDocuments: {
            create: supportingDocumentCreateMock,
          },
        },
      },
    },
  });

  return {
    __esModule: true,
    default: factory,
  };
});

const { default: twilio } =
  await import('../lib/telco/twilio.js');

const RN =
  'RN11111111111111111111111111111111';

const BU =
  'BU22222222222222222222222222222222';

const IT =
  'IT33333333333333333333333333333333';

const EN =
  'IT44444444444444444444444444444444';

describe('Twilio regulatory lifecycle primitives', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    process.env.TWILIO_ACCOUNT_SID = 'AC_test';
    process.env.TWILIO_AUTH_TOKEN = 'auth_test';
  });

  test('creates a normalized regulatory End User', async () => {
    endUserCreateMock.mockResolvedValue({
      sid: EN,
      friendlyName: 'Chatforia User 42',
      type: 'individual',
      attributes: {
        first_name: 'Test',
        last_name: 'User',
      },
    });

    const result =
      await twilio.createRegulatoryEndUser({
        friendlyName: ' Chatforia User 42 ',
        endUserType: ' INDIVIDUAL ',
        attributes: {
          first_name: 'Test',
          last_name: 'User',
        },
      });

    expect(endUserCreateMock).toHaveBeenCalledWith({
      friendlyName: 'Chatforia User 42',
      type: 'individual',
      attributes: {
        first_name: 'Test',
        last_name: 'User',
      },
    });

    expect(result.sid).toBe(EN);
    expect(result.type).toBe('individual');
  });

  test('creates a normalized regulatory Bundle', async () => {
    bundleCreateMock.mockResolvedValue({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'draft',
      validUntil: null,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });

    const result =
      await twilio.createRegulatoryBundle({
        friendlyName: ' Chatforia AU Local 42 ',
        email: ' test@example.com ',
        regulationSid: RN,
        country: ' au ',
        numberType: ' LOCAL ',
        endUserType: ' INDIVIDUAL ',
        statusCallback:
          'https://example.com/regulatory-status',
      });

    expect(bundleCreateMock).toHaveBeenCalledWith({
      friendlyName: 'Chatforia AU Local 42',
      email: 'test@example.com',
      regulationSid: RN,
      isoCountry: 'AU',
      numberType: 'local',
      endUserType: 'individual',
      isTest: false,
      statusCallback:
        'https://example.com/regulatory-status',
    });

    expect(result).toEqual({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'draft',
      validUntil: null,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });
  });

  test('assigns an object to a regulatory Bundle', async () => {
    itemAssignmentCreateMock.mockResolvedValue({
      sid: IT,
      bundleSid: BU,
      objectSid: EN,
    });

    const result =
      await twilio.assignRegulatoryItem({
        bundleSid: BU,
        objectSid: EN,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);

    expect(
      itemAssignmentCreateMock
    ).toHaveBeenCalledWith({
      objectSid: EN,
    });

    expect(result).toEqual({
      sid: IT,
      bundleSid: BU,
      objectSid: EN,
    });
  });

  test('lists normalized regulatory Bundle items', async () => {
    itemAssignmentListMock.mockResolvedValue([
      {
        sid: 'BV55555555555555555555555555555555',
        bundleSid: BU,
        objectSid: EN,
      },
      {
        sid: 'BV66666666666666666666666666666666',
        bundleSid: null,
        objectSid:
          'RD77777777777777777777777777777777',
      },
    ]);

    const result =
      await twilio.listRegulatoryBundleItems({
        bundleSid: BU,
        limit: 25,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);

    expect(
      itemAssignmentListMock
    ).toHaveBeenCalledWith({
      limit: 25,
    });

    expect(result).toEqual([
      {
        sid: 'BV55555555555555555555555555555555',
        bundleSid: BU,
        objectSid: EN,
      },
      {
        sid: 'BV66666666666666666666666666666666',
        bundleSid: BU,
        objectSid:
          'RD77777777777777777777777777777777',
      },
    ]);
  });

  test('uses the default regulatory Bundle item limit', async () => {
    itemAssignmentListMock.mockResolvedValue([]);

    await twilio.listRegulatoryBundleItems({
      bundleSid: BU,
    });

    expect(
      itemAssignmentListMock
    ).toHaveBeenCalledWith({
      limit: 100,
    });
  });

  test('rejects invalid regulatory Bundle item listing inputs', async () => {
    await expect(
      twilio.listRegulatoryBundleItems({
        bundleSid: 'BAD',
      })
    ).rejects.toThrow(
      'bundleSid must be a valid Twilio Bundle SID'
    );

    await expect(
      twilio.listRegulatoryBundleItems({
        bundleSid: BU,
        limit: 0,
      })
    ).rejects.toThrow(
      'limit must be an integer between 1 and 1000'
    );

    expect(
      itemAssignmentListMock
    ).not.toHaveBeenCalled();
  });

  test('fetches a regulatory Bundle', async () => {
    const validUntil =
      new Date('2027-09-25T00:00:00.000Z');

    bundleFetchMock.mockResolvedValue({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'twilio-approved',
      validUntil,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });

    const result =
      await twilio.getRegulatoryBundle({
        bundleSid: BU,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);
    expect(bundleFetchMock).toHaveBeenCalledTimes(1);

    expect(result.status).toBe('twilio-approved');
    expect(result.validUntil).toBe(validUntil);
  });

  test('normalizes Twilio Bundle statuses', () => {
    expect(
      twilio.normalizeRegulatoryBundleStatus('draft')
    ).toBe('DRAFT');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'pending-review'
      )
    ).toBe('PENDING_REVIEW');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'in-review'
      )
    ).toBe('IN_REVIEW');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'twilio-approved'
      )
    ).toBe('APPROVED');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'twilio-rejected'
      )
    ).toBe('REJECTED');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'provisionally-approved'
      )
    ).toBe('PROVISIONALLY_APPROVED');

    expect(
      twilio.normalizeRegulatoryBundleStatus(
        'future-provider-status'
      )
    ).toBeNull();
  });

  test('submits a regulatory Bundle for review', async () => {
    bundleUpdateMock.mockResolvedValue({
      sid: BU,
      regulationSid: RN,
      friendlyName: 'Chatforia AU Local 42',
      status: 'pending-review',
      validUntil: null,
      email: 'test@example.com',
      statusCallback:
        'https://example.com/regulatory-status',
    });

    const result =
      await twilio.submitRegulatoryBundle({
        bundleSid: BU,
      });

    expect(bundleContextMock).toHaveBeenCalledWith(BU);

    expect(bundleUpdateMock).toHaveBeenCalledWith({
      status: 'pending-review',
    });

    expect(result.status).toBe('pending-review');

    expect(result.normalizedStatus).toBe(
      'PENDING_REVIEW'
    );
  });

  test('lists normalized regulatory Supporting Document Types', async () => {
    supportingDocumentTypeListMock.mockResolvedValue([
      {
        sid: 'SCT00000000000000000000000000000001',
        friendlyName: 'Australian Passport',
        machineName: 'passport',
        fields: [
          'document_number',
          'document_expiration_date',
          'document_issuing_country',
        ],
        url:
          'https://api.twilio.com/supporting-document-types/1',
      },
      {
        sid: 'SCT00000000000000000000000000000002',
        friendlyName: 'Government Issued ID',
        machineName: 'government_issued_document',
        fields: [
          'document_number',
          'document_expiration_date',
        ],
        url:
          'https://api.twilio.com/supporting-document-types/2',
      },
    ]);

    const result =
      await twilio.listRegulatorySupportingDocumentTypes({
        limit: 25,
      });

    expect(
      supportingDocumentTypeListMock
    ).toHaveBeenCalledWith({
      limit: 25,
    });

    expect(result).toEqual([
      {
        sid:
          'SCT00000000000000000000000000000001',
        friendlyName: 'Australian Passport',
        machineName: 'passport',
        fields: [
          'document_number',
          'document_expiration_date',
          'document_issuing_country',
        ],
        url:
          'https://api.twilio.com/supporting-document-types/1',
      },
      {
        sid:
          'SCT00000000000000000000000000000002',
        friendlyName: 'Government Issued ID',
        machineName:
          'government_issued_document',
        fields: [
          'document_number',
          'document_expiration_date',
        ],
        url:
          'https://api.twilio.com/supporting-document-types/2',
      },
    ]);
  });

  test('uses the default Supporting Document Type limit', async () => {
    supportingDocumentTypeListMock.mockResolvedValue([]);

    await twilio.listRegulatorySupportingDocumentTypes();

    expect(
      supportingDocumentTypeListMock
    ).toHaveBeenCalledWith({
      limit: 100,
    });
  });

  test('rejects an invalid Supporting Document Type limit', async () => {
    await expect(
      twilio.listRegulatorySupportingDocumentTypes({
        limit: 0,
      })
    ).rejects.toThrow(
      'limit must be an integer between 1 and 1000'
    );

    await expect(
      twilio.listRegulatorySupportingDocumentTypes({
        limit: 1001,
      })
    ).rejects.toThrow(
      'limit must be an integer between 1 and 1000'
    );

    expect(
      supportingDocumentTypeListMock
    ).not.toHaveBeenCalled();
  });

  test('creates a normalized regulatory Supporting Document', async () => {
    supportingDocumentCreateMock.mockResolvedValue({
      sid:
        'SD00000000000000000000000000000001',
      accountSid: 'AC_test',
      friendlyName: 'Australian Passport',
      mimeType: 'image/jpeg',
      status: 'draft',
      failureReason: null,
      errors: [],
      type: 'passport',
      attributes: {
        document_number: 'ABC123',
        document_issuing_country: 'AU',
      },
      dateCreated:
        new Date('2026-09-24T00:00:00.000Z'),
      dateUpdated:
        new Date('2026-09-24T00:00:00.000Z'),
      url:
        'https://api.twilio.com/supporting-documents/1',
    });

    const result =
      await twilio.createRegulatorySupportingDocument({
        friendlyName: ' Australian Passport ',
        type: ' passport ',
        attributes: {
          document_number: 'ABC123',
          document_issuing_country: 'AU',
        },
      });

    expect(
      supportingDocumentCreateMock
    ).toHaveBeenCalledWith({
      friendlyName: 'Australian Passport',
      type: 'passport',
      attributes: {
        document_number: 'ABC123',
        document_issuing_country: 'AU',
      },
    });

    expect(result.sid).toBe(
      'SD00000000000000000000000000000001'
    );
    expect(result.type).toBe('passport');
    expect(result.status).toBe('draft');
    expect(result.attributes).toEqual({
      document_number: 'ABC123',
      document_issuing_country: 'AU',
    });
  });

  test('creates a Supporting Document without optional attributes', async () => {
    supportingDocumentCreateMock.mockResolvedValue({
      sid:
        'SD00000000000000000000000000000002',
      friendlyName: 'Passport',
      type: 'passport',
      status: 'draft',
    });

    const result =
      await twilio.createRegulatorySupportingDocument({
        friendlyName: 'Passport',
        type: 'passport',
      });

    expect(
      supportingDocumentCreateMock
    ).toHaveBeenCalledWith({
      friendlyName: 'Passport',
      type: 'passport',
    });

    expect(result.sid).toBe(
      'SD00000000000000000000000000000002'
    );
    expect(result.attributes).toEqual({});
    expect(result.errors).toEqual([]);
  });

  test('rejects invalid Supporting Document inputs before Twilio calls', async () => {
    await expect(
      twilio.createRegulatorySupportingDocument({
        friendlyName: ' ',
        type: 'passport',
      })
    ).rejects.toThrow(
      'friendlyName is required'
    );

    await expect(
      twilio.createRegulatorySupportingDocument({
        friendlyName: 'Passport',
        type: ' ',
      })
    ).rejects.toThrow(
      'type is required'
    );

    await expect(
      twilio.createRegulatorySupportingDocument({
        friendlyName: 'Passport',
        type: 'passport',
        attributes: [],
      })
    ).rejects.toThrow(
      'attributes must be an object'
    );

    expect(
      supportingDocumentCreateMock
    ).not.toHaveBeenCalled();
  });

  test('uploads a regulatory Supporting Document with multipart form data', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();

    globalThis.fetch = fetchMock;

    try {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          sid:
            'RD00000000000000000000000000000001',
          account_sid: 'AC_test',
          friendly_name: 'Australian Passport',
          mime_type: 'application/pdf',
          status: 'draft',
          failure_reason: null,
          errors: [],
          type: 'passport',
          attributes: {
            document_number: 'ABC123',
          },
          date_created:
            '2026-09-25T00:00:00Z',
          date_updated:
            '2026-09-25T00:00:00Z',
          url:
            '/v2/RegulatoryCompliance/SupportingDocuments/RD00000000000000000000000000000001',
        }),
      });

      const fileBuffer = Buffer.from(
        '%PDF-1.7\nChatforia regulatory test document',
        'ascii'
      );

      const result =
        await twilio.uploadRegulatorySupportingDocument({
          friendlyName: ' Australian Passport ',
          type: ' passport ',
          attributes: {
            document_number: 'ABC123',
          },
          fileBuffer,
          fileName: 'passport.pdf',
          mimeType: 'application/pdf',
        });

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] =
        fetchMock.mock.calls[0];

      expect(url).toBe(
        'https://numbers-upload.twilio.com/v2/RegulatoryCompliance/SupportingDocuments'
      );

      expect(options.method).toBe('POST');

      expect(options.headers.Accept).toBe(
        'application/json'
      );

      expect(options.headers.Authorization).toBe(
        `Basic ${Buffer.from(
          'AC_test:auth_test',
          'utf8'
        ).toString('base64')}`
      );

      expect(
        options.headers['Content-Type']
      ).toBeUndefined();

      expect(options.body).toBeInstanceOf(FormData);

      expect(
        options.body.get('FriendlyName')
      ).toBe('Australian Passport');

      expect(
        options.body.get('Type')
      ).toBe('passport');

      expect(
        JSON.parse(
          options.body.get('Attributes')
        )
      ).toEqual({
        document_number: 'ABC123',
      });

      const uploadedFile =
        options.body.get('File');

      expect(uploadedFile).toBeInstanceOf(Blob);
      expect(uploadedFile.type).toBe(
        'application/pdf'
      );
      expect(uploadedFile.name).toBe(
        'passport.pdf'
      );

      expect(result.sid).toBe(
        'RD00000000000000000000000000000001'
      );
      expect(result.accountSid).toBe(
        'AC_test'
      );
      expect(result.friendlyName).toBe(
        'Australian Passport'
      );
      expect(result.mimeType).toBe(
        'application/pdf'
      );
      expect(result.type).toBe('passport');
      expect(result.attributes).toEqual({
        document_number: 'ABC123',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects regulatory upload when declared MIME does not match file contents', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();

    globalThis.fetch = fetchMock;

    try {
      const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a,
        0x00,
      ]);

      await expect(
        twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Government ID',
          type: 'government_issued_document',
          fileBuffer: pngBuffer,
          fileName: 'id.jpg',
          mimeType: 'image/jpeg',
        })
      ).rejects.toThrow(
        'regulatory document MIME type does not match contents'
      );

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects unsupported regulatory document contents before upload', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();

    globalThis.fetch = fetchMock;

    try {
      await expect(
        twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Government ID',
          type: 'government_issued_document',
          fileBuffer: Buffer.from(
            'not-a-real-document',
            'utf8'
          ),
          fileName: 'id.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(
        'unsupported regulatory document contents'
      );

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects oversized regulatory document before upload', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();

    globalThis.fetch = fetchMock;

    try {
      const oversized =
        Buffer.alloc(
          (5 * 1024 * 1024) + 1
        );

      oversized.write(
        '%PDF-',
        0,
        'ascii'
      );

      await expect(
        twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Passport',
          type: 'passport',
          fileBuffer: oversized,
          fileName: 'passport.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(
        'regulatory document exceeds 5 MB'
      );

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sanitizes Twilio regulatory upload failures', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();

    globalThis.fetch = fetchMock;

    try {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({
          message:
            'Sensitive provider response must not escape',
        }),
      });

      const fileBuffer = Buffer.from(
        '%PDF-1.7\nTest',
        'ascii'
      );

      await expect(
        twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Passport',
          type: 'passport',
          fileBuffer,
          fileName: 'passport.pdf',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(
        'Twilio regulatory document upload failed with status 400'
      );

      try {
        await twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Passport',
          type: 'passport',
          fileBuffer,
          fileName: 'passport.pdf',
          mimeType: 'application/pdf',
        });
      } catch (error) {
        expect(error.message).not.toContain(
          'Sensitive provider response'
        );
        expect(error.message).not.toContain(
          'auth_test'
        );
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects invalid regulatory upload inputs before fetch', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn();

    globalThis.fetch = fetchMock;

    try {
      await expect(
        twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Passport',
          type: 'passport',
          fileBuffer: 'not-a-buffer',
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(
        'fileBuffer must be a Buffer'
      );

      await expect(
        twilio.uploadRegulatorySupportingDocument({
          friendlyName: 'Passport',
          type: 'passport',
          attributes: [],
          fileBuffer: Buffer.from(
            '%PDF-1.7',
            'ascii'
          ),
          mimeType: 'application/pdf',
        })
      ).rejects.toThrow(
        'attributes must be an object'
      );

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('rejects invalid lifecycle inputs before Twilio calls', async () => {
    await expect(
      twilio.createRegulatoryEndUser({
        friendlyName: 'Test',
        endUserType: 'government',
      })
    ).rejects.toThrow(
      'endUserType must be individual or business'
    );

    await expect(
      twilio.createRegulatoryBundle({
        friendlyName: 'Test',
        email: 'test@example.com',
        regulationSid: 'bad',
        country: 'AU',
        numberType: 'local',
        endUserType: 'individual',
      })
    ).rejects.toThrow(
      'regulationSid must be a valid Twilio Regulation SID'
    );

    await expect(
      twilio.assignRegulatoryItem({
        bundleSid: 'bad',
        objectSid: EN,
      })
    ).rejects.toThrow(
      'bundleSid must be a valid Twilio Bundle SID'
    );

    expect(endUserCreateMock).not.toHaveBeenCalled();
    expect(bundleCreateMock).not.toHaveBeenCalled();
    expect(itemAssignmentCreateMock).not.toHaveBeenCalled();
  });
});
