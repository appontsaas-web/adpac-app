-- Prepaid token credit system: a global tokens-per-dollar rate, and a ledger
-- of per-client token transactions driven by invoice PAID/UNPAID transitions.
-- See TokenSetting/TokenTransaction comments in schema.prisma.

CREATE TABLE "TokenSetting" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
  "tokensPerDollar" REAL NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "TokenTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "invoiceId" TEXT,
  "type" TEXT NOT NULL DEFAULT 'TOPUP',
  "tokens" REAL NOT NULL,
  "note" TEXT,
  "createdByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TokenTransaction_clientId_idx" ON "TokenTransaction"("clientId");
