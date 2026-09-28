-- AlterTable: Position gains the meta capability toggle
ALTER TABLE "Position" ADD COLUMN "canManageMeta" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: ActionLog gains an optional Meta campaign reference (nullable,
-- no inline FK constraint on SQLite ADD COLUMN — same convention as every
-- other hand-written migration in this project)
ALTER TABLE "ActionLog" ADD COLUMN "metaCampaignId" TEXT;

-- CreateTable
CREATE TABLE "MetaAdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "metaAdAccountId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME,
    "currencyCode" TEXT,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'connected',
    CONSTRAINT "MetaAdAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MetaCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adAccountId" TEXT NOT NULL,
    "metaCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dailyBudgetCents" INTEGER,
    "lifetimeBudgetCents" INTEGER,
    "hiddenFromList" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MetaCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "MetaAdAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetaCampaign_adAccountId_metaCampaignId_key" ON "MetaCampaign"("adAccountId", "metaCampaignId");

-- CreateTable
CREATE TABLE "MetaDailyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MetaDailyMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MetaCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetaDailyMetric_campaignId_date_key" ON "MetaDailyMetric"("campaignId", "date");
