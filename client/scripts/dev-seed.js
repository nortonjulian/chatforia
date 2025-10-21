import 'dotenv/config';
import prisma from '../server/utils/prismaClient.js';

const DEV_USER_ID = Number(process.env.DEV_USER_ID || 1);
const DEV_FROM = process.env.DEV_FROM_NUMBER || '+15550001111';

async function main() {
  const user = await prisma.user.findUnique({ where: { id: DEV_USER_ID } });
  if (!user) {
    console.error(`No user with id ${DEV_USER_ID}`);
    process.exit(1);
  }
  const existing = await prisma.assignedNumber.findFirst({
    where: { userId: DEV_USER_ID, e164: DEV_FROM },
  });
  if (!existing) {
    await prisma.assignedNumber.create({
      data: { userId: DEV_USER_ID, e164: DEV_FROM },
    });
    console.log(`Assigned ${DEV_FROM} to user ${DEV_USER_ID}`);
  } else {
    console.log(`User ${DEV_USER_ID} already has ${DEV_FROM}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
