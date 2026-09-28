-- AlterTable: Position gains the Snapchat capability toggle
ALTER TABLE "Position" ADD COLUMN "canManageSnapchat" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SnapAdAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "snapAdAccountId" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "currencyCode" TEXT,
    "timezone" TEXT,
    CONSTRAINT "SnapAdAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SnapCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adAccountId" TEXT NOT NULL,
    "snapCampaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dailyBudgetCents" INTEGER,
    "lifetimeBudgetCents" INTEGER,
    "hiddenFromList" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SnapCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "SnapAdAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SnapCampaign_adAccountId_snapCampaignId_key" ON "SnapCampaign"("adAccountId", "snapCampaignId");

-- CreateTable
CREATE TABLE "SnapDailyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SnapDailyMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SnapCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SnapDailyMetric_campaignId_date_key" ON "SnapDailyMetric"("campaignId", "date");

-- AlterTable: ActionLog gains the Snapchat campaign counterpart (reserved for a future AI-insights pass)
ALTER TABLE "ActionLog" ADD COLUMN "snapCampaignId" TEXT;
