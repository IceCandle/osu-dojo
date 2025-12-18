import { PrismaClient } from '@prisma/client';

// ============================================
// CRITICAL: BigInt JSON Serialization Fix
// ============================================
// Prisma uses BigInt for large numbers (osu! scores exceed 32-bit int max)
// But JSON.stringify() cannot serialize BigInt natively
// This will cause API routes to crash with: "TypeError: Do not know how to serialize a BigInt"

interface BigIntPrototype {
  toJSON?: () => number | string;
}

(BigInt.prototype as BigIntPrototype).toJSON = function (this: bigint) {
  const int = Number.parseInt(this.toString());
  // If the number exceeds JavaScript's safe integer limit (9007199254740991)
  // return as string to prevent precision loss
  return int > Number.MAX_SAFE_INTEGER ? this.toString() : int;
};

// Prisma Client Singleton
// Prevents multiple instances in development due to hot reloading

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
