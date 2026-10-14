import { jest } from '@jest/globals';

import {
  upsertLinkedPhoneContact,
} from '../linkedPhoneContactService.js';

function makePrisma({
  userContact = null,
  phoneContact = null,
} = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),

    contact: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(userContact)
        .mockResolvedValueOnce(phoneContact),

      update: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },

    smsThread: {
      updateMany: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (callback) =>
      callback(tx)
    ),
  };

  return { prisma, tx };
}

describe('upsertLinkedPhoneContact', () => {
  test('merges a duplicate phone-only contact into the existing user contact', async () => {
    const userContact = {
      id: 10,
      userId: 20,
      externalPhone: null,
      alias: 'Friend',
      externalName: null,
      favorite: false,
    };

    const phoneContact = {
      id: 11,
      userId: null,
      externalPhone: '+15551234567',
      alias: null,
      externalName: 'Saved Name',
      favorite: true,
    };

    const { prisma, tx } = makePrisma({
      userContact,
      phoneContact,
    });

    const result = {
      id: 10,
      userId: 20,
      externalPhone: '+15551234567',
    };

    tx.contact.update.mockResolvedValue(result);

    await expect(
      upsertLinkedPhoneContact(prisma, {
        ownerId: 1,
        userId: 20,
        externalPhone: '+15551234567',
      })
    ).resolves.toEqual(result);

    expect(tx.smsThread.updateMany).toHaveBeenCalledWith({
      where: {
        contactId: 11,
        userId: 1,
      },
      data: {
        contactId: 10,
      },
    });

    expect(tx.contact.delete).toHaveBeenCalledWith({
      where: {
        id: 11,
      },
    });

    expect(tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 10,
        },
        data: expect.objectContaining({
          userId: 20,
          externalPhone: '+15551234567',
          alias: 'Friend',
          externalName: 'Saved Name',
          favorite: true,
        }),
      })
    );

    expect(tx.contact.create).not.toHaveBeenCalled();
  });

  test('keeps the existing phone contact as the canonical contact when no user contact exists', async () => {
    const phoneContact = {
      id: 11,
      userId: null,
      externalPhone: '+15551234567',
      alias: 'Mom',
      externalName: 'Mom',
      favorite: false,
    };

    const { prisma, tx } = makePrisma({
      phoneContact,
    });

    tx.contact.update.mockResolvedValue({
      id: 11,
      userId: 20,
      externalPhone: '+15551234567',
    });

    await upsertLinkedPhoneContact(prisma, {
      ownerId: 1,
      userId: 20,
      externalPhone: '+15551234567',
      favorite: true,
    });

    expect(tx.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 11,
        },
        data: expect.objectContaining({
          userId: 20,
          externalPhone: '+15551234567',
          favorite: true,
        }),
      })
    );

    expect(tx.smsThread.updateMany).not.toHaveBeenCalled();
    expect(tx.contact.delete).not.toHaveBeenCalled();
  });

  test('creates a linked contact when neither contact exists', async () => {
    const { prisma, tx } = makePrisma();

    const created = {
      id: 12,
      userId: 20,
      externalPhone: '+15551234567',
    };

    tx.contact.create.mockResolvedValue(created);

    await expect(
      upsertLinkedPhoneContact(prisma, {
        ownerId: 1,
        userId: 20,
        externalPhone: '+15551234567',
        alias: 'Friend',
        externalName: 'Friend Name',
        favorite: true,
      })
    ).resolves.toEqual(created);

    expect(tx.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          ownerId: 1,
          userId: 20,
          externalPhone: '+15551234567',
          alias: 'Friend',
          externalName: 'Friend Name',
          favorite: true,
        },
      })
    );

    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(tx.contact.delete).not.toHaveBeenCalled();
  });

  test('rejects a phone contact already linked to a different user', async () => {
    const { prisma, tx } = makePrisma({
      phoneContact: {
        id: 11,
        userId: 99,
        externalPhone: '+15551234567',
      },
    });

    await expect(
      upsertLinkedPhoneContact(prisma, {
        ownerId: 1,
        userId: 20,
        externalPhone: '+15551234567',
      })
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This number is saved under a different user contact.',
    });

    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.contact.delete).not.toHaveBeenCalled();
  });

  test('rejects an existing user contact with a different saved number', async () => {
    const { prisma, tx } = makePrisma({
      userContact: {
        id: 10,
        userId: 20,
        externalPhone: '+15550000000',
      },
    });

    await expect(
      upsertLinkedPhoneContact(prisma, {
        ownerId: 1,
        userId: 20,
        externalPhone: '+15551234567',
      })
    ).rejects.toMatchObject({
      status: 409,
      message:
        'This user contact already has a different saved number.',
    });

    expect(tx.contact.update).not.toHaveBeenCalled();
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.contact.delete).not.toHaveBeenCalled();
  });

  test('rejects invalid input before opening a transaction', async () => {
    const { prisma } = makePrisma();

    await expect(
      upsertLinkedPhoneContact(prisma, {
        ownerId: 1,
        userId: 20,
        externalPhone: '',
      })
    ).rejects.toThrow(
      'Valid owner, user, and normalized phone required'
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
