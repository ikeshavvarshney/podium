-- Organizers can flag a submitted project out of public view, with a reason.
ALTER TABLE "submissions" ADD COLUMN "flag_reason" TEXT;
ALTER TABLE "submissions" ADD COLUMN "flagged_at" TIMESTAMP(3);
ALTER TABLE "submissions" ADD COLUMN "flagged_by_id" UUID;
