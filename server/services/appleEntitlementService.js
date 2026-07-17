import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library';

import prisma from '../utils/prismaClient.js';
import appleIapConfig, { getAppleProduct } from '../config/appleIapConfig.js';

import {
  assertAppSubscriptionProviderAvailable,
  recomputeUserAppEntitlement,
} from './appEntitlementService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let appleVerifier = null;

function makeError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUserId(userId) {
  const value = Number(userId);

  if (!Number.isInteger(value) || value <= 0) {
    throw makeError('A valid user ID is required.', 'INVALID_USER_ID');
  }

  return value;
}

function safeDateFromMs(value) {
  if (value == null) {
    return null;
  }

  const date = new Date(Number(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

function expectedAppleEnvironment() {
  return appleIapConfig.environment === 'production' ? 'Production' : 'Sandbox';
}

function getAppleVerifier() {
  if (appleVerifier) {
    return appleVerifier;
  }

  const appleRootCAs = [
    fs.readFileSync(path.join(__dirname, '../certs/AppleRootCA.cer')),
    fs.readFileSync(path.join(__dirname, '../certs/AppleRootCA-G3.cer')),
  ];

  const environment =
    appleIapConfig.environment === 'production'
      ? Environment.PRODUCTION
      : Environment.SANDBOX;

  appleVerifier = new SignedDataVerifier(
    appleRootCAs,
    true,
    environment,
    appleIapConfig.bundleId,
    process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined
  );

  return appleVerifier;
}

export async function verifyAppleTransaction(signedTransactionInfo) {
  try {
    return await getAppleVerifier().verifyAndDecodeTransaction(
      signedTransactionInfo
    );
  } catch {
    throw makeError(
      'Apple could not verify this transaction.',
      'APPLE_TRANSACTION_VERIFICATION_FAILED'
    );
  }
}

export async function verifyAndApplyAppleSubscription({
  userId,
  signedTransactionInfo,
  db = prisma,
  now = new Date(),
  verifyTransaction = verifyAppleTransaction,
}) {
  const normalizedUserId = normalizeUserId(userId);

  const signedValue =
    typeof signedTransactionInfo === 'string'
      ? signedTransactionInfo.trim()
      : '';

  if (!signedValue) {
    throw makeError(
      'A signed Apple transaction is required.',
      'APPLE_TRANSACTION_REQUIRED'
    );
  }

  const transaction = await verifyTransaction(signedValue);

  if (transaction.bundleId !== appleIapConfig.bundleId) {
    throw makeError(
      'The Apple transaction bundle ID is invalid.',
      'APPLE_BUNDLE_ID_MISMATCH'
    );
  }

  const expectedEnvironment = expectedAppleEnvironment();

  if (
    transaction.environment &&
    transaction.environment !== expectedEnvironment
  ) {
    throw makeError(
      'The Apple transaction environment is invalid.',
      'APPLE_ENVIRONMENT_MISMATCH'
    );
  }

  const appleProduct = getAppleProduct(transaction.productId);

  if (!appleProduct || appleProduct.kind !== 'subscription') {
    throw makeError(
      'This Apple product is not a supported Chatforia subscription.',
      'APPLE_PRODUCT_NOT_SUPPORTED'
    );
  }

  const providerSubscriptionKey = String(
    transaction.originalTransactionId || transaction.transactionId || ''
  ).trim();

  if (!providerSubscriptionKey) {
    throw makeError(
      'The Apple transaction has no subscription identifier.',
      'APPLE_SUBSCRIPTION_ID_MISSING'
    );
  }

  const existing = await db.appSubscription.findUnique({
    where: {
      provider_providerSubscriptionKey: {
        provider: 'APPLE',
        providerSubscriptionKey,
      },
    },
    select: {
      id: true,
      userId: true,
      customerReference: true,
    },
  });

  if (existing && existing.userId !== normalizedUserId) {
    throw makeError(
      'This Apple subscription is already linked to another Chatforia account.',
      'APPLE_SUBSCRIPTION_ALREADY_LINKED',
      409
    );
  }

  await assertAppSubscriptionProviderAvailable(normalizedUserId, 'APPLE', {
    db,
    now,
  });

  const startsAt = safeDateFromMs(transaction.purchaseDate);

  const endsAt = safeDateFromMs(transaction.expiresDate);

  const revokedAt = safeDateFromMs(transaction.revocationDate);

  const grantsAccess =
    !revokedAt && (!endsAt || endsAt.getTime() > now.getTime());

  const status = revokedAt ? 'REVOKED' : grantsAccess ? 'ACTIVE' : 'EXPIRED';

  const appAccountToken = transaction.appAccountToken
    ? String(transaction.appAccountToken)
    : existing?.customerReference || null;

  const result = await db.$transaction(async (tx) => {
    const subscription = await tx.appSubscription.upsert({
      where: {
        provider_providerSubscriptionKey: {
          provider: 'APPLE',
          providerSubscriptionKey,
        },
      },

      create: {
        userId: normalizedUserId,
        provider: 'APPLE',
        providerSubscriptionKey,
        customerReference: appAccountToken,
        productId: transaction.productId,
        basePlanId: appleProduct.billingPeriod || null,
        plan: appleProduct.plan,
        status,
        grantsAccess,
        autoRenewEnabled: null,
        startsAt,
        endsAt,
        lastVerifiedAt: now,

        rawResponse: {
          source: 'ios_storekit2',
          environment: transaction.environment || expectedEnvironment,
          bundleId: transaction.bundleId,
          transactionId: transaction.transactionId
            ? String(transaction.transactionId)
            : null,
          originalTransactionId: providerSubscriptionKey,
          productId: transaction.productId,
          appAccountToken,
          purchaseDate: transaction.purchaseDate ?? null,
          expiresDate: transaction.expiresDate ?? null,
          revocationDate: transaction.revocationDate ?? null,
        },
      },

      update: {
        userId: normalizedUserId,
        customerReference: appAccountToken,
        productId: transaction.productId,
        basePlanId: appleProduct.billingPeriod || null,
        plan: appleProduct.plan,
        status,
        grantsAccess,
        autoRenewEnabled: null,
        startsAt,
        endsAt,
        lastVerifiedAt: now,

        rawResponse: {
          source: 'ios_storekit2',
          environment: transaction.environment || expectedEnvironment,
          bundleId: transaction.bundleId,
          transactionId: transaction.transactionId
            ? String(transaction.transactionId)
            : null,
          originalTransactionId: providerSubscriptionKey,
          productId: transaction.productId,
          appAccountToken,
          purchaseDate: transaction.purchaseDate ?? null,
          expiresDate: transaction.expiresDate ?? null,
          revocationDate: transaction.revocationDate ?? null,
        },
      },
    });

    const entitlement = await recomputeUserAppEntitlement(normalizedUserId, {
      db: tx,
      now,
    });

    return {
      subscription,
      entitlement,
    };
  });

  return {
    transaction,
    subscription: result.subscription,
    user: result.entitlement.user,
    grantsAccess,
    status,
    alreadyLinked: Boolean(existing),
  };
}
