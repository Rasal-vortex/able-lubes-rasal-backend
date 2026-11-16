CREATE TABLE "customer_credit_bills" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "sale_id" UUID,
    "bill_number" TEXT NOT NULL,
    "bill_date" TIMESTAMPTZ(3) NOT NULL,
    "due_date" TIMESTAMPTZ(3) NOT NULL,
    "term" TEXT NOT NULL,
    "bill_amount" DECIMAL(12,2) NOT NULL,
    "prior_balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_bills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_credit_bill_payments" (
    "id" UUID NOT NULL,
    "credit_bill_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "payment_date" TIMESTAMPTZ(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_bill_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_credit_bills_sale_id_key" ON "customer_credit_bills"("sale_id");
CREATE UNIQUE INDEX "customer_credit_bills_bill_number_key" ON "customer_credit_bills"("bill_number");
CREATE INDEX "customer_credit_bills_customer_id_bill_date_idx" ON "customer_credit_bills"("customer_id", "bill_date");
CREATE INDEX "customer_credit_bill_payments_credit_bill_id_payment_date_idx" ON "customer_credit_bill_payments"("credit_bill_id", "payment_date");

ALTER TABLE "customer_credit_bills" ADD CONSTRAINT "customer_credit_bills_customer_id_fkey"
FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_credit_bills" ADD CONSTRAINT "customer_credit_bills_sale_id_fkey"
FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_credit_bill_payments" ADD CONSTRAINT "customer_credit_bill_payments_credit_bill_id_fkey"
FOREIGN KEY ("credit_bill_id") REFERENCES "customer_credit_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "customer_credit_bills" (
    "id", "customer_id", "sale_id", "bill_number", "bill_date", "due_date",
    "term", "bill_amount", "prior_balance"
)
SELECT
    gen_random_uuid(), "customer_id", "id", 'CR-' || "invoice_number", "bill_date",
    "bill_date" + INTERVAL '14 days', 'Due on agreed date', "total_amount", 0
FROM "sales"
WHERE "status" = 'POSTED'
  AND "customer_id" IS NOT NULL
  AND "payment_status" IN ('UNPAID', 'PARTIALLY_PAID');
