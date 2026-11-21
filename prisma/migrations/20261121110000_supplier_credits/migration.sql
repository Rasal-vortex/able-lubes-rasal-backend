CREATE TABLE "supplier_credits" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "source_payment_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_credits_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "supplier_credit_applications" (
    "id" UUID NOT NULL,
    "credit_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_credit_applications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_credit_applications_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "supplier_credit_application_reversals" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_credit_application_reversals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_credit_application_reversals_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "supplier_credits_cancellation_id_source_payment_id_key" ON "supplier_credits"("cancellation_id", "source_payment_id");
CREATE INDEX "supplier_credits_supplier_id_created_at_idx" ON "supplier_credits"("supplier_id", "created_at");
CREATE INDEX "supplier_credit_applications_credit_id_created_at_idx" ON "supplier_credit_applications"("credit_id", "created_at");
CREATE INDEX "supplier_credit_applications_purchase_id_idx" ON "supplier_credit_applications"("purchase_id");
CREATE UNIQUE INDEX "supplier_credit_application_reversals_cancellation_id_application_id_key" ON "supplier_credit_application_reversals"("cancellation_id", "application_id");
CREATE INDEX "supplier_credit_application_reversals_application_id_idx" ON "supplier_credit_application_reversals"("application_id");

ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "purchase_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credits" ADD CONSTRAINT "supplier_credits_source_payment_id_fkey" FOREIGN KEY ("source_payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credit_applications" ADD CONSTRAINT "supplier_credit_applications_credit_id_fkey" FOREIGN KEY ("credit_id") REFERENCES "supplier_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credit_applications" ADD CONSTRAINT "supplier_credit_applications_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credit_application_reversals" ADD CONSTRAINT "supplier_credit_application_reversals_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "purchase_cancellations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_credit_application_reversals" ADD CONSTRAINT "supplier_credit_application_reversals_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "supplier_credit_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
