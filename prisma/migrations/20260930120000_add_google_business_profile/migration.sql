-- AlterTable: Position gains the businessProfile capability toggle
ALTER TABLE "Position" ADD COLUMN "canManageBusinessProfile" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: ActionLog gains optional Business Profile references (nullable,
-- no inline FK constraint on SQLite ADD COLUMN — same convention as every
-- other hand-written migration in this project)
ALTER TABLE "ActionLog" ADD COLUMN "locationId" TEXT;
ALTER TABLE "ActionLog" ADD COLUMN "businessReviewId" TEXT;

-- CreateTable
CREATE TABLE "GoogleBusinessProfileAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "gbpAccountId" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'connected',
    CONSTRAINT "GoogleBusinessProfileAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "gbpLocationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "address" TEXT,
    "primaryPhone" TEXT,
    "openStatus" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "hiddenFromList" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessLocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "GoogleBusinessProfileAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BusinessLocation_accountId_gbpLocationId_key" ON "BusinessLocation"("accountId", "gbpLocationId");

-- CreateTable
CREATE TABLE "LocationMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "searchImpressions" INTEGER NOT NULL DEFAULT 0,
    "mapsImpressions" INTEGER NOT NULL DEFAULT 0,
    "callClicks" INTEGER NOT NULL DEFAULT 0,
    "websiteClicks" INTEGER NOT NULL DEFAULT 0,
    "directionRequests" INTEGER NOT NULL DEFAULT 0,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LocationMetric_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "BusinessLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LocationMetric_locationId_date_key" ON "LocationMetric"("locationId", "date");

-- CreateTable
CREATE TABLE "BusinessReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "gbpReviewName" TEXT NOT NULL,
    "reviewerName" TEXT,
    "starRating" INTEGER NOT NULL,
    "comment" TEXT,
    "createTime" DATETIME NOT NULL,
    "updateTime" DATETIME NOT NULL,
    "replyComment" TEXT,
    "replyUpdateTime" DATETIME,
    "replyState" TEXT NOT NULL DEFAULT 'NONE',
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessReview_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "BusinessLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BusinessReview_locationId_gbpReviewName_key" ON "BusinessReview"("locationId", "gbpReviewName");
