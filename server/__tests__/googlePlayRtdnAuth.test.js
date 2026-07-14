/**
 * @jest-environment node
 */
import { jest } from '@jest/globals';

import {
  extractBearerToken,
  verifyGooglePlayRtdnRequest,
} from '../services/googlePlayRtdnAuthService.js';

const audience =
  'https://api.chatforia.com/billing/google-play/rtdn';

const expectedEmail =
  'chatforia-pubsub@project.iam.gserviceaccount.com';

function buildRequest(authorization) {
  return {
    headers: authorization
      ? { authorization }
      : {},
  };
}

function buildClient(payload) {
  return {
    verifyIdToken: jest.fn().mockResolvedValue({
      getPayload: () => payload,
    }),
  };
}

describe('extractBearerToken', () => {
  test('extracts a bearer token case-insensitively', () => {
    expect(
      extractBearerToken(
        buildRequest('bearer signed-token')
      )
    ).toBe('signed-token');
  });

  test('rejects malformed authorization headers', () => {
    expect(
      extractBearerToken(
        buildRequest('Basic credentials')
      )
    ).toBeNull();

    expect(
      extractBearerToken(
        buildRequest('Bearer token with spaces')
      )
    ).toBeNull();
  });
});

describe('verifyGooglePlayRtdnRequest', () => {
  test('returns 503 when RTDN authentication is not configured', async () => {
    await expect(
      verifyGooglePlayRtdnRequest(
        buildRequest('Bearer signed-token'),
        {
          client: buildClient({}),
          audience: '',
          expectedServiceAccountEmail: '',
        }
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'GOOGLE_PLAY_RTDN_NOT_CONFIGURED',
    });
  });

  test('returns 401 when the bearer token is missing', async () => {
    const client = buildClient({});

    await expect(
      verifyGooglePlayRtdnRequest(
        buildRequest(),
        {
          client,
          audience,
          expectedServiceAccountEmail:
            expectedEmail,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_PLAY_RTDN_TOKEN_REQUIRED',
    });

    expect(
      client.verifyIdToken
    ).not.toHaveBeenCalled();
  });

  test('returns 401 when Google rejects the token', async () => {
    const client = {
      verifyIdToken:
        jest.fn().mockRejectedValue(
          new Error('invalid signature')
        ),
    };

    await expect(
      verifyGooglePlayRtdnRequest(
        buildRequest('Bearer invalid-token'),
        {
          client,
          audience,
          expectedServiceAccountEmail:
            expectedEmail,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_PLAY_RTDN_TOKEN_INVALID',
    });
  });

  test('rejects an invalid issuer', async () => {
    const client = buildClient({
      iss: 'https://attacker.example',
      email_verified: true,
      email: expectedEmail,
    });

    await expect(
      verifyGooglePlayRtdnRequest(
        buildRequest('Bearer signed-token'),
        {
          client,
          audience,
          expectedServiceAccountEmail:
            expectedEmail,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_PLAY_RTDN_ISSUER_INVALID',
    });
  });

  test('rejects an unverified email identity', async () => {
    const client = buildClient({
      iss: 'https://accounts.google.com',
      email_verified: false,
      email: expectedEmail,
    });

    await expect(
      verifyGooglePlayRtdnRequest(
        buildRequest('Bearer signed-token'),
        {
          client,
          audience,
          expectedServiceAccountEmail:
            expectedEmail,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 401,
      code: 'GOOGLE_PLAY_RTDN_EMAIL_UNVERIFIED',
    });
  });

  test('rejects the wrong service-account identity', async () => {
    const client = buildClient({
      iss: 'https://accounts.google.com',
      email_verified: true,
      email:
        'other-account@project.iam.gserviceaccount.com',
    });

    await expect(
      verifyGooglePlayRtdnRequest(
        buildRequest('Bearer signed-token'),
        {
          client,
          audience,
          expectedServiceAccountEmail:
            expectedEmail,
        }
      )
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'GOOGLE_PLAY_RTDN_IDENTITY_FORBIDDEN',
    });
  });

  test('accepts the configured Google service account', async () => {
    const client = buildClient({
      iss: 'https://accounts.google.com',
      aud: audience,
      sub: '1234567890',
      email_verified: true,
      email: expectedEmail.toUpperCase(),
    });

    const result =
      await verifyGooglePlayRtdnRequest(
        buildRequest('Bearer signed-token'),
        {
          client,
          audience,
          expectedServiceAccountEmail:
            expectedEmail,
        }
      );

    expect(
      client.verifyIdToken
    ).toHaveBeenCalledWith({
      idToken: 'signed-token',
      audience,
    });

    expect(result).toEqual({
      email: expectedEmail,
      subject: '1234567890',
      audience,
      issuer:
        'https://accounts.google.com',
    });
  });
});
