-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'OPENROUTER');

-- AlterTable
ALTER TABLE "SystemSettings" ADD COLUMN     "aiFastModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini',
ADD COLUMN     "aiProvider" "AiProvider" NOT NULL DEFAULT 'OPENAI';

