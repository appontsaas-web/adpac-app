-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "paymentLink" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "paymentMethod" TEXT;

-- CreateTable
CREATE TABLE "ClientAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'VIEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClientAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAssignment_clientId_userId_key" ON "ClientAssignment"("clientId", "userId");
