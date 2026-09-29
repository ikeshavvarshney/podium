-- A square logo and a wide banner per event, and which standard registration fields it asks for.
ALTER TABLE "events" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "events" ADD COLUMN "banner_url" TEXT;
ALTER TABLE "events" ADD COLUMN "registration_fields" JSONB NOT NULL DEFAULT '{}';
