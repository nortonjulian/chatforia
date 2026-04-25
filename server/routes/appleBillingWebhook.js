import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../utils/prismaClient.js';
import { getAddonConfig } from '../utils/billingProducts.js';
import appleIapConfig, { getAppleProduct } from '../config/appleIapConfig.js';
import {
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library';

const router = express.Router();

const __dirname = new URL('.', import.meta.url).pathname;

const appleRootCAs = [
  fs.readFileSync(path.join(__dirname, '../certs/AppleRootCA.cer')),
  fs.readFileSync(path.join(__dirname, '../certs/AppleRootCA-G3.cer')),
];

const appleEnvironment =
  appleIapConfig.environment === 'production'
    ? Environment.PRODUCTION
    : Environment.SANDBOX;

const appleVerifier = new SignedDataVerifier(
  appleRootCAs,
  true, // enableOnlineChecks
  appleEnvironment,
  appleIapConfig.bundleId,
  process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined
);

function safeDateFromMs(value) {
  if (value == null) return null;
  const dt = new Date(Number(value));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function verifyAppleNotification(signedPayload) {
  return await appleVerifier.verifyAndDecodeNotification(signedPayload);
}

async function verifyAppleTransaction(signedTransactionInfo) {
  return await appleVerifier.verifyAndDecodeTransaction(signedTransactionInfo);
}

async function applySubscriptionStateFromTransaction({
  userId,
  transaction,
}) {
  const appleProduct = getAppleProduct(transaction.productId);
  if (!appleProduct || appleProduct.kind !== 'subscription') {
    return { ignored: true, reason: 'non-subscription-or-unknown-product' };
  }

  const expiresAt = safeDateFromMs(transaction.expiresDate);

  await prisma.user.update({
    where: { id: Number(userId) },
    data: {
      plan: appleProduct.plan,
      subscriptionStatus: 'ACTIVE',
      billingProvider: 'APPLE',
      billingSubscriptionId: String(
        transaction.originalTransactionId || transaction.transactionId
      ),
      subscriptionEndsAt: expiresAt,
    },
  });

  return { ignored: false, kind: 'subscription', plan: appleProduct.plan };
}

async function applyAddonFromTransaction({
  userId,
  transaction,
}) {
  const appleProduct = getAppleProduct(transaction.productId);
  if (!appleProduct || appleProduct.kind !== 'addon') {
    return { ignored: true, reason: 'non-addon-or-unknown-product' };
  }

  const addonCfg = getAddonConfig(appleProduct.addonKind);
  if (!addonCfg) {
    return { ignored: true, reason: 'unknown-addon-mapping' };
  }

  const purchasedAt = safeDateFromMs(transaction.purchaseDate) || new Date();
  const expiresAt =
    safeDateFromMs(transaction.expiresDate) ||
    new Date(purchasedAt.getTime() + addonCfg.daysValid * 24 * 60 * 60 * 1000);

  try {
    await prisma.mobileDataPackPurchase.create({
      data: {
        userId: Number(userId),
        kind: addonCfg.type,
        addonKind: addonCfg.addonKind,
        purchasedAt,
        expiresAt,
        totalDataMb: addonCfg.dataMb,
        remainingDataMb: addonCfg.dataMb,
        billingTransactionId: String(transaction.transactionId),
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      return { ignored: false, duplicate: true, kind: 'addon' };
    }
    throw err;
  }

  return { ignored: false, duplicate: false, kind: 'addon' };
}

async function findUserIdForTransaction(transaction) {
  const billingSubscriptionId = String(
    transaction.originalTransactionId || transaction.transactionId
  );

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { billingSubscriptionId },
      ],
    },
    select: { id: true },
  });

  return user?.id || null;
}

async function downgradeUserFromTransaction(transaction) {
  const userId = await findUserIdForTransaction(transaction);
  if (!userId) return false;

  await prisma.user.update({
  where: { id: Number(userId) },
  data: {
    plan: 'FREE',
    subscriptionStatus: 'EXPIRED',
    subscriptionEndsAt: null,
    billingProvider: 'APPLE',
    billingSubscriptionId: String(
      transaction.originalTransactionId || transaction.transactionId
    ),
  },
});

    await scheduleProtectedNumbersForDowngrade(userId);

    return true;
}

async function scheduleProtectedNumbersForDowngrade(userId) {
  const holdDays = Number(process.env.NUMBER_HOLD_DAYS) || 14;
  const holdUntil = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);

  await prisma.phoneNumber.updateMany({
    where: {
      assignedUserId: Number(userId),
      status: 'ASSIGNED',
      keepLocked: true,
    },
    data: {
      keepLocked: false,
      holdUntil,
      releaseAfter: null,
      isLeasable: false,
      isPurchasable: false,
    },
  });
}

router.post('/apple/notifications', async (req, res) => {
  try {
    const { signedPayload } = req.body || {};

    if (!signedPayload) {
      return res.status(400).json({ error: 'signedPayload is required' });
    }

    const notification = await verifyAppleNotification(signedPayload);

    const expectedEnv =
      appleIapConfig.environment === 'production' ? 'Production' : 'Sandbox';

    if (notification?.data?.environment && notification.data.environment !== expectedEnv) {
      return res.status(400).json({ error: 'Environment mismatch' });
    }

    const notificationType = notification.notificationType || null;
    const subtype = notification.subtype || null;

    const signedTransactionInfo = notification?.data?.signedTransactionInfo || null;
    const signedRenewalInfo = notification?.data?.signedRenewalInfo || null;

    let transaction = null;
    if (signedTransactionInfo) {
      transaction = await verifyAppleTransaction(signedTransactionInfo);

      if (transaction.bundleId !== appleIapConfig.bundleId) {
        return res.status(400).json({ error: 'Bundle ID mismatch' });
      }

      if (transaction.environment && transaction.environment !== expectedEnv) {
        return res.status(400).json({ error: 'Environment mismatch' });
      }
    }

    switch (notificationType) {
      case 'SUBSCRIBED':
      case 'DID_RENEW':
      case 'OFFER_REDEEMED':
      case 'RENEWAL_EXTENDED':
      case 'RENEWAL_EXTENSION': {
        if (!transaction) break;

        const userId = await findUserIdForTransaction(transaction);
        if (!userId) {
          console.warn('[appleBillingWebhook] no user found for subscription activation', {
            notificationType,
            subtype,
            originalTransactionId: transaction.originalTransactionId,
            transactionId: transaction.transactionId,
          });
          break;
        }

        await applySubscriptionStateFromTransaction({
          userId,
          transaction,
        });
        break;
      }

      case 'EXPIRED':
      case 'REVOKE':
      case 'REFUND': {
        if (!transaction) break;

        const handled = await downgradeUserFromTransaction(transaction);
        if (!handled) {
          console.warn('[appleBillingWebhook] no user found for downgrade', {
            notificationType,
            subtype,
            originalTransactionId: transaction.originalTransactionId,
            transactionId: transaction.transactionId,
          });
        }
        break;
      }

      case 'DID_FAIL_TO_RENEW':
      case 'GRACE_PERIOD_EXPIRED': {
        if (!transaction) break;

        const userId = await findUserIdForTransaction(transaction);
        if (!userId) break;

        await prisma.user.update({
          where: { id: Number(userId) },
          data: {
            subscriptionStatus:
              notificationType === 'DID_FAIL_TO_RENEW' ? 'PAST_DUE' : 'EXPIRED',
            billingProvider: 'APPLE',
            billingSubscriptionId: String(
              transaction.originalTransactionId || transaction.transactionId
            ),
          },
        });
        break;
      }

      case 'CONSUMPTION_REQUEST': {
        if (!transaction) break;

        const userId = await findUserIdForTransaction(transaction);
        if (!userId) break;

        await applyAddonFromTransaction({
          userId,
          transaction,
        });
        break;
      }

      default: {
        console.log('[appleBillingWebhook] unhandled notification', {
          notificationType,
          subtype,
          hasTransaction: !!signedTransactionInfo,
          hasRenewal: !!signedRenewalInfo,
        });
        break;
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('[appleBillingWebhook] error:', err, {
      stack: err?.stack,
    });
    return res.status(500).json({
      error: err?.message || 'Apple notification handling failed',
    });
  }
});

export default router;