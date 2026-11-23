ALTER TABLE "customer_payments"
ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "customer_payments_idempotency_key_key"
ON "customer_payments"("idempotency_key");

ALTER TABLE "customer_store_credit_transactions"
ADD COLUMN "cancellation_id" UUID,
ADD COLUMN "reversal_of_transaction_id" UUID;

CREATE UNIQUE INDEX "customer_store_credit_transactions_reversal_of_transaction_id_key"
ON "customer_store_credit_transactions"("reversal_of_transaction_id");

CREATE INDEX "customer_store_credit_transactions_cancellation_id_idx"
ON "customer_store_credit_transactions"("cancellation_id");

ALTER TABLE "customer_store_credit_transactions"
ADD CONSTRAINT "customer_store_credit_transactions_cancellation_id_fkey"
FOREIGN KEY ("cancellation_id") REFERENCES "sale_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_store_credit_transactions"
ADD CONSTRAINT "customer_store_credit_transactions_reversal_of_transaction_id_fkey"
FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "customer_store_credit_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
