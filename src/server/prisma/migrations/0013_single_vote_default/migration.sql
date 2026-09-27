-- Single vote (one vote per person) is the default voting method; quadratic is opt in.
ALTER TABLE "voting_configs" ALTER COLUMN "method" SET DEFAULT 'SINGLE';
