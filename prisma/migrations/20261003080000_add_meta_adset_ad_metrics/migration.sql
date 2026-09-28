-- CreateTable
CREATE TABLE "MetaAdSetMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "adSetId" TEXT NOT NULL,
    "adSetName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dailyBudgetCents" INTEGER,
    "targetingSummary" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MetaAdSetMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MetaCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetaAdSetMetric_campaignId_date_adSetId_key" ON "MetaAdSetMetric"("campaignId", "date", "adSetId");

-- CreateTable
CREATE TABLE "MetaAdMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "adSetId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MetaAdMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MetaCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetaAdMetric_campaignId_date_adId_key" ON "MetaAdMetric"("campaignId", "date", "adId");
