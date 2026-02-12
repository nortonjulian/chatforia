import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

import bcrypt from 'bcrypt';

export async function seedDevData() {
  console.log('💬 Seeding dev chat data...');

  const hashed = await bcrypt.hash('Temp12345!', 10);

  const julian = await prisma.user.upsert({
    where: { email: 'nortonjulian@gmail.com' },
    update: {},
    create: {
      username: 'julian',
      email: 'nortonjulian@gmail.com',
      phoneNumber: '3333333333',
      password: hashed,
    },
  });

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      username: 'alice',
      email: 'alice@example.com',
      phoneNumber: '1111111111',
      password: hashed,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      username: 'bob',
      email: 'bob@example.com',
      phoneNumber: '2222222222',
      password: hashed,
    },
  });

  // ✅ create room BEFORE using room.id anywhere
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

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDevData()
    .catch((e) => {
      console.error('❌ seedDevData failed:', e);
      process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());
}
