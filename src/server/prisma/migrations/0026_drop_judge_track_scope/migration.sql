-- Organizers decide which projects a judge gets through assignments alone.
ALTER TABLE "event_memberships" DROP COLUMN "track_scope";
ALTER TABLE "tracks" DROP COLUMN "restricted";
