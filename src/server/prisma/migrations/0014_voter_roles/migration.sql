-- Who may cast community votes, per role. Visitors are people with no role in the event,
-- signed in or not; participants were always allowed, so both default to allowed.
ALTER TABLE "voting_configs"
  ADD COLUMN "allow_visitors" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allow_participants" BOOLEAN NOT NULL DEFAULT true;
