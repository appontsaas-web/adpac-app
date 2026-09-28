-- CreateTable
CREATE TABLE "ClientMonthlyGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "metricType" TEXT,
    "targetValue" REAL,
    "note" TEXT,
    "setByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientMonthlyGoal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientMonthlyGoal_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientMonthlyGoal_clientId_monthKey_key" ON "ClientMonthlyGoal"("clientId", "monthKey");

-- CreateTable
CREATE TABLE "HiddenMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HiddenMetric_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "HiddenMetric_positionId_platform_metricKey_key" ON "HiddenMetric"("positionId", "platform", "metricKey");
