-- SPEND now locks in daily off real ad spend instead of monthly off the AI
-- impact showcase value. See TokenTransaction.dayKey comment in schema.prisma.
ALTER TABLE "TokenTransaction" ADD COLUMN "dayKey" TEXT;
