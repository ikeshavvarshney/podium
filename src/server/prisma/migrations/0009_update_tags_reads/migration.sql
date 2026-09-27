-- CreateEnum
CREATE TYPE "UpdateTag" AS ENUM ('ROUNDS', 'DEADLINE', 'JUDGING', 'LOGISTICS', 'VOTING');

-- AlterTable
ALTER TABLE "event_updates" ADD COLUMN     "tag" "UpdateTag" NOT NULL DEFAULT 'LOGISTICS';

-- CreateTable
CREATE TABLE "update_reads" (
    "update_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "update_reads_pkey" PRIMARY KEY ("update_id","user_id")
);

-- AddForeignKey
ALTER TABLE "update_reads" ADD CONSTRAINT "update_reads_update_id_fkey" FOREIGN KEY ("update_id") REFERENCES "event_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "update_reads" ADD CONSTRAINT "update_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
