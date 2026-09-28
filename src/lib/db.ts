import { PrismaClient } from '@prisma/client';

// Standard Next.js dev-mode singleton so hot-reload doesn't spawn a new
// Prisma client (and DB connection) on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
