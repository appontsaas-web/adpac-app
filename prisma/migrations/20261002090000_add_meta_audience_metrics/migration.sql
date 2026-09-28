-- AlterTable: MetaDailyMetric gains per-day reach (see schema.prisma comment
-- on non-additivity across days)
ALTER TABLE "MetaDailyMetric" ADD COLUMN "reach" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MetaAudienceMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimensionValue" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "MetaAudienceMetric_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MetaCampaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetaAudienceMetric_campaignId_date_dimension_dimensionValue_key" ON "MetaAudienceMetric"("campaignId", "date", "dimension", "dimensionValue");
