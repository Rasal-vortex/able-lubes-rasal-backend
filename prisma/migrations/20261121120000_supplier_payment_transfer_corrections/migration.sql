CREATE TABLE "supplier_credit_reversals" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "credit_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_credit_reversals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_credit_reversals_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "supplier_payment_transfer_decisions" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "original_payment_id" UUID NOT NULL,
    "payment_group_id" UUID,
    "was_transferred" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payment_transfer_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_credit_reversals_cancellation_id_credit_id_key"
    ON "supplier_credit_reversals"("cancellation_id", "credit_id");
CREATE INDEX "supplier_credit_reversals_credit_id_created_at_idx"
    ON "supplier_credit_reversals"("credit_id", "created_at");
CREATE UNIQUE INDEX "supplier_payment_transfer_decisions_cancellation_id_original_payment_id_key"
    ON "supplier_payment_transfer_decisions"("cancellation_id", "original_payment_id");
CREATE INDEX "supplier_payment_transfer_decisions_payment_group_id_created_at_idx"
    ON "supplier_payment_transfer_decisions"("payment_group_id", "created_at");

ALTER TABLE "supplier_credit_reversals"
    ADD CONSTRAINT "supplier_credit_reversals_cancellation_id_fkey"
    FOREIGN KEY ("cancellation_id") REFERENCES "purchase_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credit_reversals"
    ADD CONSTRAINT "supplier_credit_reversals_credit_id_fkey"
    FOREIGN KEY ("credit_id") REFERENCES "supplier_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_transfer_decisions"
    ADD CONSTRAINT "supplier_payment_transfer_decisions_cancellation_id_fkey"
    FOREIGN KEY ("cancellation_id") REFERENCES "purchase_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_transfer_decisions"
    ADD CONSTRAINT "supplier_payment_transfer_decisions_original_payment_id_fkey"
    FOREIGN KEY ("original_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
