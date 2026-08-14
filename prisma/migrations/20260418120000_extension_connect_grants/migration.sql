CREATE TABLE "ExtensionConnectGrant" (
    "id" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'chrome_extension',
    "verifierHash" TEXT NOT NULL,
    "approvedUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtensionConnectGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExtensionConnectGrant_verifierHash_key"
ON "ExtensionConnectGrant"("verifierHash");

CREATE INDEX "ExtensionConnectGrant_expiresAt_idx"
ON "ExtensionConnectGrant"("expiresAt");

CREATE INDEX "ExtensionConnectGrant_approvedUserId_createdAt_idx"
ON "ExtensionConnectGrant"("approvedUserId", "createdAt");
