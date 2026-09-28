-- DropIndex
DROP INDEX "SearchTermMetric_campaignId_date_searchTerm_matchedKeywordText_key";

-- CreateIndex
CREATE UNIQUE INDEX "SearchTermMetric_campaignId_date_searchTerm_key" ON "SearchTermMetric"("campaignId", "date", "searchTerm");
