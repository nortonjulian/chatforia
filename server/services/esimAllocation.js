import prisma from '../utils/prismaClient.js';
import * as esimProvider from './providers/esimProvider.js';
import { ESIM_PROVIDER } from '../config/esim.js';

export function isSubscriberIccidUniqueCollision(err) {
  if (err?.code !== 'P2002') {
    return false;
  }

  const target = err?.meta?.target;

  if (Array.isArray(target)) {
    return target.some(
      (field) =>
        String(field).toLowerCase() === 'iccid'
    );
  }

  if (typeof target === 'string') {
    return target.toLowerCase().includes('iccid');
  }

  /*
   * Prisma/database versions can differ in how the unique target is
   * represented. P2002 during Subscriber creation is safe to treat as
   * an allocation collision here because ICCID is the unique value
   * being claimed by this allocation path.
   */
  return true;
}

export async function createSubscriberWithAllocatedEsim(
  {
    userId,
    purchaseId,
    region,
    product,
    addonKind,
    stripeSessionId,
    stripePaymentIntentId,
    testMode,
  },
  {
    prismaClient = prisma,
    provider = esimProvider,
    esimProviderName = ESIM_PROVIDER,
  } = {}
) {
  const excludedIccids = [];
  const maxAttempts = 25;

  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt += 1
  ) {
    const reserve =
      await provider.reserveEsimProfile({
        userId: Number(userId),
        region,
        addonKind,
        planCode: addonKind,
        testMode,
        excludedIccids,
      });

    const providerProfileId =
      reserve?.providerProfileId || null;

    const iccid =
      reserve?.iccid
        ? String(reserve.iccid)
        : null;

    if (!providerProfileId) {
      const err = new Error(
        'eSIM provider did not return providerProfileId'
      );
      err.code =
        'ESIM_PROVIDER_PROFILE_ID_MISSING';
      throw err;
    }

    if (!iccid) {
      const err = new Error(
        'eSIM provider did not return an ICCID'
      );
      err.code =
        'ESIM_PROVIDER_ICCID_MISSING';
      throw err;
    }

    try {
      const subscriber =
        await prismaClient.subscriber.create({
          data: {
            userId: Number(userId),
            purchaseId,
            provider:
              esimProviderName || 'unknown',
            providerProfileId,
            iccid,
            iccidHint:
              reserve?.iccidHint ||
              iccid,
            smdp:
              reserve?.smdp || null,
            activationCode:
              reserve?.activationCode ||
              null,

            /*
             * Store only provider-supplied installation values.
             * Do not manufacture a production LPA payload here.
             * Mock mode already returns its own test LPA/QR values.
             */
            lpaUri:
              reserve?.lpaUri ||
              reserve?.qrPayload ||
              null,

            qrPayload:
              reserve?.qrPayload ||
              reserve?.lpaUri ||
              null,

            region,
            status: 'PENDING',

            providerMeta: {
              stripeSessionId,
              stripePaymentIntentId,
              product,
              addonKind,
              reserve,
            },
          },
        });

      return {
        subscriber,
        reserve,
        providerProfileId,
      };
    } catch (err) {
      if (
        !isSubscriberIccidUniqueCollision(err)
      ) {
        throw err;
      }

      /*
       * Another request claimed this ICCID between provider discovery
       * and our INSERT. Exclude it and ask the provider adapter for
       * another candidate.
       */
      excludedIccids.push(iccid);

      console.warn(
        '[esimAllocation] eSIM ICCID allocation collision; retrying',
        {
          userId: Number(userId),
          purchaseId,
          iccid,
          attempt,
        }
      );
    }
  }

  const err = new Error(
    `Unable to claim an available eSIM after ${maxAttempts} attempts`
  );

  err.code =
    'ESIM_ALLOCATION_EXHAUSTED';

  throw err;
}

export default {
  isSubscriberIccidUniqueCollision,
  createSubscriberWithAllocatedEsim,
};
