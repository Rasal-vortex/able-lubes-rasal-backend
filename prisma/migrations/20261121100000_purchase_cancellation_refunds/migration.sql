ALTER TYPE "StockMovementType" ADD VALUE 'PURCHASE_CANCEL';

CREATE TABLE "purchase_cancellations" (
    "id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by_id" UUID,
    CONSTRAINT "purchase_cancellations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_payment_reversals" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "original_payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payment_reversals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_payment_reversals_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "supplier_refunds" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_refunds_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "supplier_refund_settlements" (
    "id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "created_by_id" UUID,
    "settled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_refund_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_refund_settlement_lines" (
    "id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "original_payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "reference" TEXT,
    CONSTRAINT "supplier_refund_settlement_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_refund_settlement_lines_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "purchase_cancellations_idempotency_key_key" ON "purchase_cancellations"("idempotency_key");
CREATE UNIQUE INDEX "purchase_cancellations_purchase_id_key" ON "purchase_cancellations"("purchase_id");
CREATE INDEX "purchase_cancellations_cancelled_at_idx" ON "purchase_cancellations"("cancelled_at");
CREATE INDEX "purchase_cancellations_cancelled_by_id_idx" ON "purchase_cancellations"("cancelled_by_id");
CREATE UNIQUE INDEX "supplier_payment_reversals_cancellation_id_original_payment_id_key" ON "supplier_payment_reversals"("cancellation_id", "original_payment_id");
CREATE INDEX "supplier_payment_reversals_original_payment_id_idx" ON "supplier_payment_reversals"("original_payment_id");
CREATE UNIQUE INDEX "supplier_refunds_cancellation_id_key" ON "supplier_refunds"("cancellation_id");
CREATE UNIQUE INDEX "supplier_refund_settlements_idempotency_key_key" ON "supplier_refund_settlements"("idempotency_key");
CREATE INDEX "supplier_refund_settlements_refund_id_settled_at_idx" ON "supplier_refund_settlements"("refund_id", "settled_at");
CREATE INDEX "supplier_refund_settlements_created_by_id_idx" ON "supplier_refund_settlements"("created_by_id");
CREATE INDEX "supplier_refund_settlement_lines_settlement_id_idx" ON "supplier_refund_settlement_lines"("settlement_id");
CREATE INDEX "supplier_refund_settlement_lines_original_payment_id_idx" ON "supplier_refund_settlement_lines"("original_payment_id");

ALTER TABLE "purchase_cancellations" ADD CONSTRAINT "purchase_cancellations_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cancellations" ADD CONSTRAINT "purchase_cancellations_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "purchase_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_reversals" ADD CONSTRAINT "supplier_payment_reversals_original_payment_id_fkey" FOREIGN KEY ("original_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_refunds" ADD CONSTRAINT "supplier_refunds_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "purchase_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_refund_settlements" ADD CONSTRAINT "supplier_refund_settlements_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "supplier_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_refund_settlements" ADD CONSTRAINT "supplier_refund_settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_refund_settlement_lines" ADD CONSTRAINT "supplier_refund_settlement_lines_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "supplier_refund_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_refund_settlement_lines" ADD CONSTRAINT "supplier_refund_settlement_lines_original_payment_id_fkey" FOREIGN KEY ("original_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
