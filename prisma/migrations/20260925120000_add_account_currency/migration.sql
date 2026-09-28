-- Add currencyCode to GoogleAdsAccount: the account's real billing currency
-- (e.g. "SAR"), used to convert cost/conversion-value figures to USD before
-- they're stored in DailyMetric/AudienceMetric.
ALTER TABLE "GoogleAdsAccount" ADD COLUMN "currencyCode" TEXT;
