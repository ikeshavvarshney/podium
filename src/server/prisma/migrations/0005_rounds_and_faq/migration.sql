-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "advances" INTEGER,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rounds_event_id_position_idx" ON "rounds"("event_id", "position");

-- CreateIndex
CREATE INDEX "faq_items_event_id_position_idx" ON "faq_items"("event_id", "position");

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
