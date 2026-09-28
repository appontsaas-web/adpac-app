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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Position" ("canManageCampaigns", "canManageGoogleAds", "canManageTargeting", "createdAt", "id", "name") SELECT "canManageCampaigns", "canManageGoogleAds", "canManageTargeting", "createdAt", "id", "name" FROM "Position";
DROP TABLE "Position";
ALTER TABLE "new_Position" RENAME TO "Position";
CREATE UNIQUE INDEX "Position_name_key" ON "Position"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
