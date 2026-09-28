-- Account "subscription" validity — see Client.validUntil comment in schema.prisma.
ALTER TABLE "Client" ADD COLUMN "validUntil" DATETIME;
