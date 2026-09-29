-- Admins can be limited to parts of an event. Existing admins keep full access.
ALTER TABLE "event_memberships" ADD COLUMN "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "event_memberships" SET "permissions" = ARRAY['ALL'] WHERE "role" = 'ADMIN';
