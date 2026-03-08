-- Create table for persistent parsed JD cache
CREATE TABLE "ParsedJDCache" (
    "id" TEXT NOT NULL,
    "jdHash" TEXT NOT NULL,
    "parsedJD" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ParsedJDCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParsedJDCache_jdHash_key" ON "ParsedJDCache"("jdHash");
CREATE INDEX "ParsedJDCache_jdHash_idx" ON "ParsedJDCache"("jdHash");
CREATE INDEX "ParsedJDCache_expiresAt_idx" ON "ParsedJDCache"("expiresAt");
