-- Audit entries form one hash chain per event (and one for instance-level entries). The chain is
-- written by the database, so no insert path can skip it, and rows cannot be edited or deleted.
ALTER TABLE "audit_logs"
  ADD COLUMN "chain_seq" INTEGER,
  ADD COLUMN "prev_hash" TEXT,
  ADD COLUMN "hash" TEXT;

CREATE INDEX "audit_logs_event_id_chain_seq_idx" ON "audit_logs"("event_id", "chain_seq");

-- actor_id is left out: it is cleared when an account is deleted, and the summary names the actor.
CREATE FUNCTION audit_log_digest(prev TEXT, r "audit_logs") RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(concat_ws(E'\x1f',
    prev, r."id"::text, coalesce(r."event_id"::text, ''), r."chain_seq"::text, r."action",
    coalesce(r."target_type", ''), coalesce(r."target_id", ''), r."summary", r."metadata"::text,
    coalesce(r."ip_hash", ''), to_char(r."created_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS')
  ), 'UTF8')), 'hex')
$$;

CREATE FUNCTION audit_logs_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(NEW."event_id"::text, 'instance'), 0));
  SELECT "chain_seq", "hash" INTO last FROM "audit_logs"
    WHERE "event_id" IS NOT DISTINCT FROM NEW."event_id" AND "chain_seq" IS NOT NULL
    ORDER BY "chain_seq" DESC LIMIT 1;
  NEW."chain_seq" := coalesce(last."chain_seq", 0) + 1;
  NEW."prev_hash" := coalesce(last."hash", 'genesis');
  NEW."hash" := audit_log_digest(NEW."prev_hash", NEW);
  RETURN NEW;
END $$;

CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Allowed only as the cascade of deleting the whole event.
    IF OLD."event_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "events" WHERE "id" = OLD."event_id") THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Allowed only as ON DELETE SET NULL of a deleted actor.
  IF OLD."actor_id" IS NOT NULL AND NEW."actor_id" IS NULL
     AND NOT EXISTS (SELECT 1 FROM "users" WHERE "id" = OLD."actor_id")
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END $$;

-- Chain the rows that already exist, oldest first.
DO $$
DECLARE
  r "audit_logs";
  seq INTEGER;
  prev TEXT;
  cur UUID;
  first BOOLEAN := true;
BEGIN
  FOR r IN SELECT * FROM "audit_logs" ORDER BY "event_id" NULLS FIRST, "created_at", "id" LOOP
    IF first OR r."event_id" IS DISTINCT FROM cur THEN
      seq := 0; prev := 'genesis'; cur := r."event_id"; first := false;
    END IF;
    seq := seq + 1;
    r."chain_seq" := seq;
    UPDATE "audit_logs" SET "chain_seq" = seq, "prev_hash" = prev, "hash" = audit_log_digest(prev, r) WHERE "id" = r."id";
    SELECT "hash" INTO prev FROM "audit_logs" WHERE "id" = r."id";
  END LOOP;
END $$;

CREATE TRIGGER "audit_logs_chain" BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_chain();
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
