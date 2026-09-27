-- CreateEnum
CREATE TYPE "RoundKind" AS ENUM ('QUIZ', 'SUBMISSION', 'SCORING', 'PITCH', 'VOTE', 'RESULT');

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN     "kind" "RoundKind" NOT NULL DEFAULT 'SCORING';
