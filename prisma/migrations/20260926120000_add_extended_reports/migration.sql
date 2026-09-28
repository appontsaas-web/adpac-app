-- AlterTable
ALTER TABLE "DailyMetric" ADD COLUMN "searchImpressionSharePct" REAL;
ALTER TABLE "DailyMetric" ADD COLUMN "searchBudgetLostSharePct" REAL;
ALTER TABLE "DailyMetric" ADD COLUMN "searchRankLostSharePct" REAL;
ALTER TABLE "DailyMetric" ADD COLUMN "biddingStrategyType" TEXT;

-- CreateTable
CREATE TABLE "KeywordMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "adGroupName" TEXT NOT NULL,
    "keywordText" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    "avgCpcCents" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" INTEGER,
    CONSTRAINT "KeywordMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KeywordMetric_campaignId_date_adGroupId_keywordText_matchType_key" ON "KeywordMetric"("campaignId", "date", "adGroupId", "keywordText", "matchType");

-- CreateTable
CREATE TABLE "SearchTermMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "matchedKeywordText" TEXT,
    "matchType" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SearchTermMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SearchTermMetric_campaignId_date_searchTerm_matchedKeywordText_key" ON "SearchTermMetric"("campaignId", "date", "searchTerm", "matchedKeywordText");

-- CreateTable
CREATE TABLE "AdGroupMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "adGroupName" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AdGroupMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdGroupMetric_campaignId_date_adGroupId_key" ON "AdGroupMetric"("campaignId", "date", "adGroupId");

-- CreateTable
CREATE TABLE "AdMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AdMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdMetric_campaignId_date_adId_key" ON "AdMetric"("campaignId", "date", "adId");
