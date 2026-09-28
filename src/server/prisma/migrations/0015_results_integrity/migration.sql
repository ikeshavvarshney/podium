-- Published results point at one immutable run, and every run records a digest of the
-- ballots it read, so publication can refuse a run that no longer matches the ballots.
ALTER TABLE "normalization_runs" ADD COLUMN "ballot_digest" TEXT;

ALTER TABLE "events" ADD COLUMN "published_run_id" UUID;
CREATE UNIQUE INDEX "events_published_run_id_key" ON "events"("published_run_id");
ALTER TABLE "events" ADD CONSTRAINT "events_published_run_id_fkey"
  FOREIGN KEY ("published_run_id") REFERENCES "normalization_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Events already published keep showing what they showed before: their latest run.
UPDATE "events" e SET "published_run_id" = (
  SELECT r."id" FROM "normalization_runs" r WHERE r."event_id" = e."id" ORDER BY r."created_at" DESC LIMIT 1
) WHERE e."results_published" = true;
