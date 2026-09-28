-- AlterTable
ALTER TABLE "voting_configs" ADD COLUMN     "max_choices" INTEGER;

-- CreateTable
CREATE TABLE "voter_verifications" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified_at" TIMESTAMP(3),
    "token_hash" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voter_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voter_verifications_token_hash_key" ON "voter_verifications"("token_hash");

-- CreateIndex
CREATE INDEX "voter_verifications_event_id_email_idx" ON "voter_verifications"("event_id", "email");

-- AddForeignKey
ALTER TABLE "voter_verifications" ADD CONSTRAINT "voter_verifications_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

