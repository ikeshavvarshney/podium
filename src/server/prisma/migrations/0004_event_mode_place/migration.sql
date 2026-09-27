-- CreateEnum
CREATE TYPE "EventMode" AS ENUM ('ONLINE', 'IN_PERSON', 'HYBRID');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "mode" "EventMode" NOT NULL DEFAULT 'HYBRID',
ADD COLUMN     "place" TEXT;
