import pkg from '@prisma/client';
const { PrismaClient } = pkg;
const prisma = new PrismaClient();

import bcrypt from 'bcrypt';

async function run() {
  console.log('💬 Creating dev chat data...');

  const hashed = await bcrypt.hash('Temp12345!', 10);

  // ✅ Upsert the user you're actually logging in as
    const julian = await prisma.user.upsert({
    where: { email: 'nortonjulian@gmail.com' },
    update: {},
    create: {
        username: 'julian',                  // can be anything if username is required
        email: 'nortonjulian@gmail.com',
        phoneNumber: '3333333333',
        password: hashed,                    // dev password for seeded account
    },
    });

  const alice = await prisma.user.upsert({
    where: { email: 'alice@example.com' },
    update: {},
    create: {
      username: 'alice',
      email: 'alice@example.com',
      phoneNumber: '1111111111',
      password: hashed,          // ✅ required
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'bob@example.com' },
    update: {},
    create: {
      username: 'bob',
      email: 'bob@example.com',
      phoneNumber: '2222222222',
      password: hashed,          // ✅ required
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

  const total = await prisma.message.count();
  console.log('✅ Dev messages total:', total);
  console.log('👉 Seed roomId:', room.id);
}

run()
  .catch((e) => console.error('❌ seedDevData failed:', e))
  .finally(async () => prisma.$disconnect());
