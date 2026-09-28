-- Purely a local display preference: hides a campaign from the default
-- Campaigns list view. Never touches Google Ads, works regardless of status.
ALTER TABLE "Campaign" ADD COLUMN "hiddenFromList" BOOLEAN NOT NULL DEFAULT false;
