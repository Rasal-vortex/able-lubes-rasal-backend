ALTER TABLE "supplier_payments"
ADD COLUMN "payment_group_id" UUID;

CREATE INDEX "supplier_payments_payment_group_id_idx"
ON "supplier_payments"("payment_group_id");
