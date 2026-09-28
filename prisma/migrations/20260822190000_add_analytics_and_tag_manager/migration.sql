-- CreateTable
CREATE TABLE "GoogleAnalyticsProperty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "ga4PropertyId" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'connected',
    CONSTRAINT "GoogleAnalyticsProperty_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleTagManagerContainer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "gtmAccountId" TEXT NOT NULL,
    "gtmContainerId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'connected',
    CONSTRAINT "GoogleTagManagerContainer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Position" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "canManageCampaigns" BOOLEAN NOT NULL DEFAULT false,
    "canManageGoogleAds" BOOLEAN NOT NULL DEFAULT false,
    "canManageTargeting" BOOLEAN NOT NULL DEFAULT false,
    "canViewInvoices" BOOLEAN NOT NULL DEFAULT false,
    "canViewReporting" BOOLEAN NOT NULL DEFAULT false,
    "canManageTagManager" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Position" ("canManageCampaigns", "canManageGoogleAds", "canManageTargeting", "canViewInvoices", "canViewReporting", "createdAt", "id", "name") SELECT "canManageCampaigns", "canManageGoogleAds", "canManageTargeting", "canViewInvoices", "canViewReporting", "createdAt", "id", "name" FROM "Position";
DROP TABLE "Position";
ALTER TABLE "new_Position" RENAME TO "Position";
CREATE UNIQUE INDEX "Position_name_key" ON "Position"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
