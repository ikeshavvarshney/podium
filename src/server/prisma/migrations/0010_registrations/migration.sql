-- CreateEnum
CREATE TYPE "QuestionStage" AS ENUM ('REGISTRATION', 'SUBMISSION');

-- CreateEnum
CREATE TYPE "Experience" AS ENUM ('FIRST_EVENT', 'A_FEW', 'MANY');

-- AlterTable
ALTER TABLE "custom_questions" ADD COLUMN     "stage" "QuestionStage" NOT NULL DEFAULT 'SUBMISSION';

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "current_role" TEXT,
    "experience" "Experience",
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "track_id" UUID,
    "share_profile" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "rules_accepted_at" TIMESTAMP(3) NOT NULL,
    "conduct_accepted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registrations_event_id_user_id_key" ON "registrations"("event_id", "user_id");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
