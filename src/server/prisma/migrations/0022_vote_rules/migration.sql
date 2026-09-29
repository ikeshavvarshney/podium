-- New polls default to one vote per voter; existing polls keep the limit they were configured with.
ALTER TABLE "voting_configs" ALTER COLUMN "max_choices" SET DEFAULT 1;

-- Whether a voter may change their vote until the poll closes. Existing polls keep today's behaviour.
ALTER TABLE "voting_configs" ADD COLUMN "allow_vote_change" BOOLEAN NOT NULL DEFAULT true;
