-- AlterTable
ALTER TABLE "DailyMetric" ADD COLUMN "searchTopImpressionSharePct" REAL;
ALTER TABLE "DailyMetric" ADD COLUMN "searchAbsoluteTopImpressionSharePct" REAL;

-- CreateTable
CREATE TABLE "AssetGroupMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "assetGroupId" TEXT NOT NULL,
    "assetGroupName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    "conversionValueCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AssetGroupMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssetGroupMetric_campaignId_date_assetGroupId_key" ON "AssetGroupMetric"("campaignId", "date", "assetGroupId");
