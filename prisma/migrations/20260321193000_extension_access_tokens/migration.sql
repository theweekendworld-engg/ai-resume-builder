CREATE TABLE "ExtensionAccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "client" TEXT NOT NULL DEFAULT 'chrome_extension',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtensionAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExtensionAccessToken_tokenHash_key"
ON "ExtensionAccessToken"("tokenHash");

CREATE INDEX "ExtensionAccessToken_userId_client_revokedAt_expiresAt_idx"
ON "ExtensionAccessToken"("userId", "client", "revokedAt", "expiresAt");

CREATE INDEX "ExtensionAccessToken_expiresAt_idx"
ON "ExtensionAccessToken"("expiresAt");
