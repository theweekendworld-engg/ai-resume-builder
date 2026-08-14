-- CreateTable
CREATE TABLE "ApplicationQuestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "platform" TEXT,
    "companyName" TEXT,
    "roleTitle" TEXT,
    "questionText" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "answerMode" TEXT,
    "helperText" JSONB,
    "draftAnswers" JSONB,
    "sourceFacts" JSONB,
    "warnings" JSONB,
    "finalAnswer" TEXT,
    "selectedTone" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplicationQuestion_userId_updatedAt_idx" ON "ApplicationQuestion"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ApplicationQuestion_userId_sourceUrl_updatedAt_idx" ON "ApplicationQuestion"("userId", "sourceUrl", "updatedAt");
