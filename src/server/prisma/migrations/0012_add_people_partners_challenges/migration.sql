-- CreateEnum
CREATE TYPE "PersonKind" AS ENUM ('SPEAKER', 'MENTOR');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "challenge_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "event_people" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "kind" "PersonKind" NOT NULL DEFAULT 'MENTOR',
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "org" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "sponsor" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_people_event_id_position_idx" ON "event_people"("event_id", "position");

-- CreateIndex
CREATE INDEX "partners_event_id_position_idx" ON "partners"("event_id", "position");

-- CreateIndex
CREATE INDEX "challenges_event_id_position_idx" ON "challenges"("event_id", "position");

-- AddForeignKey
ALTER TABLE "event_people" ADD CONSTRAINT "event_people_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
