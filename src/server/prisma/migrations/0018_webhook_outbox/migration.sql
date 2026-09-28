-- CreateEnum
CREATE TYPE "WebhookOutboxStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "webhook_deliveries" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "outbox_id" UUID;

-- CreateTable
CREATE TABLE "webhook_outbox" (
    "id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "WebhookOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_outbox_status_next_attempt_at_idx" ON "webhook_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_outbox_webhook_id_created_at_idx" ON "webhook_outbox"("webhook_id", "created_at");

-- AddForeignKey
ALTER TABLE "webhook_outbox" ADD CONSTRAINT "webhook_outbox_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "webhook_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

