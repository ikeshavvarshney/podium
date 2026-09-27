-- CreateTable
CREATE TABLE "pairwise_rankings" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "judge_id" UUID NOT NULL,
    "group_key" TEXT NOT NULL,
    "order" TEXT[],
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pairwise_rankings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pairwise_rankings_event_id_idx" ON "pairwise_rankings"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "pairwise_rankings_event_id_judge_id_group_key_key" ON "pairwise_rankings"("event_id", "judge_id", "group_key");

-- AddForeignKey
ALTER TABLE "pairwise_rankings" ADD CONSTRAINT "pairwise_rankings_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairwise_rankings" ADD CONSTRAINT "pairwise_rankings_judge_id_fkey" FOREIGN KEY ("judge_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
