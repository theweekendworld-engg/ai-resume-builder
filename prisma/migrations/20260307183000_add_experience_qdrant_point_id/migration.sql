-- Add point id storage for experience vectors in Qdrant
ALTER TABLE "UserExperience"
ADD COLUMN "qdrantPointId" TEXT;
