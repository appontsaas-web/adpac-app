-- Lets a self-serve "Request recharge" invoice be distinguished from ones
-- admin created directly. See Invoice.source comment in schema.prisma.
ALTER TABLE "Invoice" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Invoice" ADD COLUMN "requestedByUserId" TEXT;
