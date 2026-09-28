-- Admin-defined override for a client+month's AI optimization impact rate
-- (see /api/ai-insights/impact). Falls back to a placeholder calculation
-- when no row exists for a given client+month.
CREATE TABLE "AiImpactOverride" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientId" TEXT NOT NULL,
  "monthKey" TEXT NOT NULL,
  "optimizationRatePercent" REAL NOT NULL,
  "setByUserId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AiImpactOverride_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AiImpactOverride_clientId_monthKey_key" ON "AiImpactOverride"("clientId", "monthKey");
