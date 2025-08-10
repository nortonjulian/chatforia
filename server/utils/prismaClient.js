import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis;
export const prisma =
  globalForPrisma.__prisma || new PrismaClient({ log: ['error', 'warn'] });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

export default prisma;

