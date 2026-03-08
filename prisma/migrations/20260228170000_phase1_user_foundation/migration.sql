-- CreateEnum
CREATE TYPE "ProjectSource" AS ENUM ('github', 'manual');

-- CreateEnum
CREATE TYPE "KnowledgeType" AS ENUM ('achievement', 'oss_contribution', 'certification', 'award', 'publication', 'custom');

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "linkedin" TEXT NOT NULL DEFAULT '',
    "github" TEXT NOT NULL DEFAULT '',
    "defaultTitle" TEXT NOT NULL DEFAULT '',
    "defaultSummary" TEXT NOT NULL DEFAULT '',
    "yearsExperience" TEXT NOT NULL DEFAULT '',
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "githubUrl" TEXT,
    "technologies" JSONB NOT NULL DEFAULT '[]',
    "readme" TEXT NOT NULL DEFAULT '',
    "source" "ProjectSource" NOT NULL DEFAULT 'manual',
    "qdrantPointId" TEXT,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserExperience" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL DEFAULT '',
    "current" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEducation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" TEXT NOT NULL,
    "fieldOfStudy" TEXT NOT NULL DEFAULT '',
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL DEFAULT '',
    "current" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserEducation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "KnowledgeType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "qdrantPointId" TEXT,
    "embedded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProject_userId_githubUrl_key" ON "UserProject"("userId", "githubUrl");

-- CreateIndex
CREATE INDEX "UserProject_userId_updatedAt_idx" ON "UserProject"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "UserExperience_userId_updatedAt_idx" ON "UserExperience"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "UserEducation_userId_idx" ON "UserEducation"("userId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_userId_type_idx" ON "KnowledgeItem"("userId", "type");
