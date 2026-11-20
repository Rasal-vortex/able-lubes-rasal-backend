CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'UPI', 'BANK', 'OTHER');

CREATE TABLE "sale_cancellations" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by_id" UUID,
    "collected_amount" DECIMAL(12,2) NOT NULL,
    "pending_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "sale_cancellations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_cancellations_collected_amount_check" CHECK ("collected_amount" >= 0),
    CONSTRAINT "sale_cancellations_pending_amount_check" CHECK ("pending_amount" >= 0 AND "pending_amount" <= "collected_amount")
);

CREATE TABLE "sale_refunds" (
    "id" UUID NOT NULL,
    "idempotency_key" UUID,
    "cancellation_id" UUID NOT NULL,
    "original_payment_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "reference" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_refunds_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "sale_cancellations_sale_id_key" ON "sale_cancellations"("sale_id");
CREATE INDEX "sale_cancellations_cancelled_at_idx" ON "sale_cancellations"("cancelled_at");
CREATE INDEX "sale_cancellations_cancelled_by_id_idx" ON "sale_cancellations"("cancelled_by_id");
CREATE INDEX "sale_refunds_cancellation_id_created_at_idx" ON "sale_refunds"("cancellation_id", "created_at");
CREATE INDEX "sale_refunds_created_by_id_idx" ON "sale_refunds"("created_by_id");
CREATE INDEX "sale_refunds_original_payment_id_idx" ON "sale_refunds"("original_payment_id");
CREATE UNIQUE INDEX "sale_refunds_idempotency_key_key" ON "sale_refunds"("idempotency_key");

ALTER TABLE "sale_cancellations" ADD CONSTRAINT "sale_cancellations_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_cancellations" ADD CONSTRAINT "sale_cancellations_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "sale_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_refunds" ADD CONSTRAINT "sale_refunds_original_payment_id_fkey" FOREIGN KEY ("original_payment_id") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
