-- CreateEnum
CREATE TYPE "JoinDirection" AS ENUM ('ASK', 'INVITE');

-- CreateEnum
CREATE TYPE "JoinStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "board_track_id" UUID,
ADD COLUMN     "needs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "seeker_listings" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "pitch" TEXT NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "track_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seeker_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "join_requests" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "direction" "JoinDirection" NOT NULL,
    "status" "JoinStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seeker_listings_event_id_user_id_key" ON "seeker_listings"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "join_requests_event_id_user_id_idx" ON "join_requests"("event_id", "user_id");

-- CreateIndex
CREATE INDEX "join_requests_team_id_status_idx" ON "join_requests"("team_id", "status");

-- AddForeignKey
ALTER TABLE "seeker_listings" ADD CONSTRAINT "seeker_listings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seeker_listings" ADD CONSTRAINT "seeker_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
