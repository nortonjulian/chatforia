import { jest } from '@jest/globals';

import {
  createSubscriberWithAllocatedEsim,
  isSubscriberIccidUniqueCollision,
} from '../esimAllocation.js';

describe('eSIM allocation', () => {
  test(
    'recognizes an ICCID Prisma unique collision',
    () => {
      expect(
        isSubscriberIccidUniqueCollision({
          code: 'P2002',
          meta: {
            target: ['iccid'],
          },
        })
      ).toBe(true);

      expect(
        isSubscriberIccidUniqueCollision({
          code: 'P2002',
          meta: {
            target: 'Subscriber_iccid_key',
          },
        })
      ).toBe(true);

      expect(
        isSubscriberIccidUniqueCollision({
          code: 'P2002',
        })
      ).toBe(true);

      expect(
        isSubscriberIccidUniqueCollision({
          code: 'P2002',
          meta: {
            target: ['providerProfileId'],
          },
        })
      ).toBe(false);

      expect(
        isSubscriberIccidUniqueCollision({
          code: 'OTHER',
          meta: {
            target: ['iccid'],
          },
        })
      ).toBe(false);
    }
  );

  test(
    'retries after an ICCID collision and excludes the claimed ICCID',
    async () => {
      const firstIccid =
        '8910300000059080801';

      const secondIccid =
        '8910300000059080802';

      const provider = {
        reserveEsimProfile:
          jest
            .fn()
            .mockResolvedValueOnce({
              providerProfileId:
                firstIccid,
              iccid:
                firstIccid,
              iccidHint:
                '891030••••••',
              activationCode:
                'ACT-FIRST',
              providerMeta: {
                state:
                  'AVAILABLE',
              },
            })
            .mockResolvedValueOnce({
              providerProfileId:
                secondIccid,
              iccid:
                secondIccid,
              iccidHint:
                '891030••••••',
              activationCode:
                'ACT-SECOND',
              providerMeta: {
                state:
                  'AVAILABLE',
              },
            }),
      };

      const collision = Object.assign(
        new Error(
          'Unique constraint failed on ICCID'
        ),
        {
          code: 'P2002',
          meta: {
            target: ['iccid'],
          },
        }
      );

      const createdSubscriber = {
        id: 77,
        userId: 999,
        purchaseId: 123,
        provider: 'telna',
        providerProfileId:
          secondIccid,
        iccid:
          secondIccid,
        status:
          'PENDING',
      };

      const prismaClient = {
        subscriber: {
          create:
            jest
              .fn()
              .mockRejectedValueOnce(
                collision
              )
              .mockResolvedValueOnce(
                createdSubscriber
              ),
        },
      };

      const result =
        await createSubscriberWithAllocatedEsim(
          {
            userId: 999,
            purchaseId: 123,
            region: 'US',
            product:
              'chatforia_esim_local_3',
            addonKind:
              'chatforia_esim_local_3_premium',
            stripeSessionId:
              'cs_collision_test',
            stripePaymentIntentId:
              'pi_collision_test',
            testMode: false,
          },
          {
            prismaClient,
            provider,
            esimProviderName:
              'telna',
          }
        );

      expect(
        provider.reserveEsimProfile
      ).toHaveBeenCalledTimes(2);

      expect(
        provider.reserveEsimProfile
          .mock.calls[0][0]
          .excludedIccids
      ).toEqual([
        firstIccid,
      ]);

      expect(
        provider.reserveEsimProfile
          .mock.calls[1][0]
          .excludedIccids
      ).toEqual([
        firstIccid,
      ]);

      expect(
        prismaClient.subscriber.create
      ).toHaveBeenCalledTimes(2);

      expect(
        prismaClient.subscriber.create
          .mock.calls[0][0]
          .data.iccid
      ).toBe(
        firstIccid
      );

      expect(
        prismaClient.subscriber.create
          .mock.calls[1][0]
          .data.iccid
      ).toBe(
        secondIccid
      );

      expect(
        result
      ).toEqual(
        expect.objectContaining({
          subscriber:
            createdSubscriber,
          providerProfileId:
            secondIccid,
          reserve:
            expect.objectContaining({
              iccid:
                secondIccid,
            }),
        })
      );
    }
  );

  test(
    'does not retry a non-ICCID database error',
    async () => {
      const provider = {
        reserveEsimProfile:
          jest
            .fn()
            .mockResolvedValue({
              providerProfileId:
                '8910300000059080803',
              iccid:
                '8910300000059080803',
            }),
      };

      const databaseError =
        Object.assign(
          new Error(
            'Different unique constraint'
          ),
          {
            code: 'P2002',
            meta: {
              target: [
                'providerProfileId',
              ],
            },
          }
        );

      const prismaClient = {
        subscriber: {
          create:
            jest
              .fn()
              .mockRejectedValue(
                databaseError
              ),
        },
      };

      await expect(
        createSubscriberWithAllocatedEsim(
          {
            userId: 999,
            purchaseId: 123,
            region: 'US',
            product:
              'chatforia_esim_local_3',
            addonKind:
              'chatforia_esim_local_3_premium',
            stripeSessionId:
              'cs_non_iccid_error',
            stripePaymentIntentId:
              'pi_non_iccid_error',
            testMode: false,
          },
          {
            prismaClient,
            provider,
            esimProviderName:
              'telna',
          }
        )
      ).rejects.toBe(
        databaseError
      );

      expect(
        provider.reserveEsimProfile
      ).toHaveBeenCalledTimes(1);
    }
  );
});
