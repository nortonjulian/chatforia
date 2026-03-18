import pkg from '@prisma/client';
import { generateKeyPair } from '../utils/encryption.js';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

import bcrypt from 'bcrypt';

export async function seedDevData() {
  console.log('💬 Seeding dev chat data...');

  const hashed = await bcrypt.hash('Temp12345!', 10);

  const { publicKey: julianPublicKey } = generateKeyPair();
  const { publicKey: alicePublicKey } = generateKeyPair();
  const { publicKey: bobPublicKey } = generateKeyPair();

  const julian = await prisma.user.upsert({
    where: { email: 'nortonjulian@gmail.com' },
    update: {
      email: 'nortonjulian@gmail.com',
      phoneNumber: '3333333333',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: julianPublicKey,
    },
    create: {
      username: 'julian',
      email: 'nortonjulian@gmail.com',
      phoneNumber: '3333333333',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: julianPublicKey,
    },
  });

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: alicePublicKey,
    },
    create: {
      username: 'alice',
      email: 'alice@example.com',
      phoneNumber: '1111111111',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: alicePublicKey,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: bobPublicKey,
    },
    create: {
      username: 'bob',
      email: 'bob@example.com',
      phoneNumber: '2222222222',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: bobPublicKey,
    },
  });

  const room = await prisma.chatRoom.create({
    data: { isGroup: false },
  });

  await prisma.participant.createMany({
    data: [
      { chatRoomId: room.id, userId: julian.id },
      { chatRoomId: room.id, userId: alice.id },
      { chatRoomId: room.id, userId: bob.id },
    ],
    skipDuplicates: true,
  });

  for (let i = 0; i < 20; i++) {
    await prisma.message.create({
      data: {
        chatRoomId: room.id,
        senderId: i % 2 === 0 ? alice.id : bob.id,
        rawContent: `Seeded message ${i + 1}`,
      },
    });
  }

  console.log('✅ Julian userId:', julian.id);
  console.log('✅ Seed roomId:', room.id);
}