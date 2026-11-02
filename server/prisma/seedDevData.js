import prisma from '../utils/prismaClient.js';
import { generateKeyPair } from '../utils/encryption.js';

import bcrypt from 'bcrypt';
import {
  assertConnectedDevSeedTarget,
  getDevSeedPassword,
} from './assertDevSeedTarget.js';

export async function seedDevData() {
  const seedPassword = getDevSeedPassword();
  await assertConnectedDevSeedTarget(prisma);

  const fixtures = [1, 2, 3, 4].map((number) => ({
    username: `dev_user_${number}`,
    email: `dev_user_${number}@example.com`,
  }));

  const existing = await prisma.user.findMany({
    where: {
      OR: [
        { email: { in: fixtures.map((user) => user.email) } },
        { username: { in: fixtures.map((user) => user.username) } },
      ],
    },
    select: {
      username: true,
      email: true,
    },
  });

  for (const user of existing) {
    const fixture = fixtures.find(
      (item) =>
        item.username === user.username ||
        item.email === user.email
    );

    if (
      !fixture ||
      user.username !== fixture.username ||
      user.email !== fixture.email
    ) {
      throw new Error(
        'Development fixture identity collision detected.'
      );
    }
  }

  console.log('💬 Seeding dev account fixtures...');

  const hashed = await bcrypt.hash(seedPassword, 10);

  const { publicKey: devUser1PublicKey } = generateKeyPair();
  const { publicKey: devUser3PublicKey } = generateKeyPair();
  const { publicKey: devUser4PublicKey } = generateKeyPair();
  const { publicKey: devUser2PublicKey } = generateKeyPair();

  const devUser = await prisma.user.upsert({
    where: { email: 'dev_user_1@example.com' },
    update: {},
    create: {
      username: 'dev_user_1',
      email: 'dev_user_1@example.com',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: devUser1PublicKey,
    },
  });

  await prisma.user.upsert({
    where: { email: 'dev_user_2@example.com' },
    update: {},
    create: {
      username: 'dev_user_2',
      email: 'dev_user_2@example.com',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: devUser2PublicKey,
    },
  });

  await prisma.user.upsert({
    where: { email: 'dev_user_3@example.com' },
    update: {},
    create: {
      username: 'dev_user_3',
      email: 'dev_user_3@example.com',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: devUser3PublicKey,
    },
  });

  await prisma.user.upsert({
    where: { email: 'dev_user_4@example.com' },
    update: {},
    create: {
      username: 'dev_user_4',
      email: 'dev_user_4@example.com',
      passwordHash: hashed,
      emailVerifiedAt: new Date(),
      publicKey: devUser4PublicKey,
    },
  });

  console.log('✅ Dev userId:', devUser.id);

}
