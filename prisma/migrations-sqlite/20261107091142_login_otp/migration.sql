-- CreateTable
CREATE TABLE "LoginOtp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "procRoles" TEXT NOT NULL DEFAULT '',
    "apps" TEXT NOT NULL DEFAULT 'DTCP',
    "position" TEXT NOT NULL DEFAULT '',
    "dtcpPerms" TEXT NOT NULL DEFAULT '',
    "subRoles" TEXT NOT NULL DEFAULT '',
    "areas" TEXT NOT NULL DEFAULT '',
    "priceRoles" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("apps", "areas", "createdAt", "dtcpPerms", "id", "name", "passwordHash", "position", "priceRoles", "procRoles", "role", "subRoles", "username") SELECT "apps", "areas", "createdAt", "dtcpPerms", "id", "name", "passwordHash", "position", "priceRoles", "procRoles", "role", "subRoles", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LoginOtp_userId_idx" ON "LoginOtp"("userId");
