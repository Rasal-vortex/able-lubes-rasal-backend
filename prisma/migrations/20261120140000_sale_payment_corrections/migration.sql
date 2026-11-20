CREATE TYPE "SalePaymentCorrectionType" AS ENUM ('REVERSAL', 'ACTUAL_RECEIPT');

ALTER TABLE "sale_cancellations"
ADD COLUMN "actual_received_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Existing cancellations used the recorded collection as the assumed actual amount.
UPDATE "sale_cancellations"
SET "actual_received_amount" = "collected_amount";

CREATE TABLE "sale_payment_corrections" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "original_payment_id" UUID,
    "type" "SalePaymentCorrectionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_payment_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_payment_corrections_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "sale_payment_corrections_cancellation_id_created_at_idx"
ON "sale_payment_corrections"("cancellation_id", "created_at");
CREATE INDEX "sale_payment_corrections_original_payment_id_idx"
ON "sale_payment_corrections"("original_payment_id");
CREATE INDEX "sale_payment_corrections_created_by_id_idx"
ON "sale_payment_corrections"("created_by_id");

ALTER TABLE "sale_payment_corrections"
ADD CONSTRAINT "sale_payment_corrections_cancellation_id_fkey"
FOREIGN KEY ("cancellation_id") REFERENCES "sale_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_payment_corrections"
ADD CONSTRAINT "sale_payment_corrections_original_payment_id_fkey"
FOREIGN KEY ("original_payment_id") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_payment_corrections"
ADD CONSTRAINT "sale_payment_corrections_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
