-- Lets a SPEND ledger row be tied to a specific calendar month, so a
-- month's AI optimization impact value can only ever deduct tokens once.
-- See TokenTransaction.monthKey comment in schema.prisma.
ALTER TABLE "TokenTransaction" ADD COLUMN "monthKey" TEXT;
