CREATE TYPE "SalesReturnStatus" AS ENUM ('NONE', 'PARTIALLY_RETURNED', 'FULLY_RETURNED');
CREATE TYPE "SalesReturnSettlementType" AS ENUM ('BALANCE_OFFSET', 'REFUND', 'CUSTOMER_CREDIT', 'PENDING');
CREATE TYPE "CustomerStoreCreditType" AS ENUM ('CREDIT', 'DEBIT');

ALTER TYPE "PaymentMethod" ADD VALUE 'STORE_CREDIT';
ALTER TYPE "StockMovementType" ADD VALUE 'SALE_RETURN';

ALTER TABLE "sales"
ADD COLUMN "return_status" "SalesReturnStatus" NOT NULL DEFAULT 'NONE';

CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "settlement_type" "SalesReturnSettlementType" NOT NULL,
    "returned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_by_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "credit_applied_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_returns_amount_check" CHECK ("amount" > 0),
    CONSTRAINT "sales_returns_credit_applied_amount_check" CHECK ("credit_applied_amount" >= 0 AND "credit_applied_amount" <= "amount")
);

CREATE TABLE "sales_return_items" (
    "id" UUID NOT NULL,
    "sales_return_id" UUID NOT NULL,
    "sale_item_id" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "cost_amount" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_return_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "sales_return_items_amount_check" CHECK ("amount" >= 0 AND "cost_amount" >= 0)
);

CREATE TABLE "sales_return_settlements" (
    "id" UUID NOT NULL,
    "idempotency_key" UUID,
    "sales_return_id" UUID NOT NULL,
    "type" "SalesReturnSettlementType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RefundMethod",
    "reference" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_return_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_return_settlements_amount_check" CHECK ("amount" > 0)
);

CREATE TABLE "customer_store_credit_transactions" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "type" "CustomerStoreCreditType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sales_return_id" UUID,
    "sale_id" UUID,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_store_credit_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customer_store_credit_transactions_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "sales_returns_idempotency_key_key" ON "sales_returns"("idempotency_key");
CREATE INDEX "sales_returns_sale_id_returned_at_idx" ON "sales_returns"("sale_id", "returned_at");
CREATE INDEX "sales_returns_returned_by_id_idx" ON "sales_returns"("returned_by_id");
CREATE INDEX "sales_return_items_sales_return_id_idx" ON "sales_return_items"("sales_return_id");
CREATE INDEX "sales_return_items_sale_item_id_idx" ON "sales_return_items"("sale_item_id");
CREATE UNIQUE INDEX "sales_return_settlements_idempotency_key_key" ON "sales_return_settlements"("idempotency_key");
CREATE INDEX "sales_return_settlements_sales_return_id_created_at_idx" ON "sales_return_settlements"("sales_return_id", "created_at");
CREATE INDEX "sales_return_settlements_created_by_id_idx" ON "sales_return_settlements"("created_by_id");
CREATE UNIQUE INDEX "customer_store_credit_transactions_sales_return_id_key" ON "customer_store_credit_transactions"("sales_return_id");
CREATE UNIQUE INDEX "customer_store_credit_transactions_payment_id_key" ON "customer_store_credit_transactions"("payment_id");
CREATE INDEX "customer_store_credit_transactions_customer_id_created_at_idx" ON "customer_store_credit_transactions"("customer_id", "created_at");
CREATE INDEX "customer_store_credit_transactions_sale_id_idx" ON "customer_store_credit_transactions"("sale_id");

ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_returned_by_id_fkey" FOREIGN KEY ("returned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items" ADD CONSTRAINT "sales_return_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_settlements" ADD CONSTRAINT "sales_return_settlements_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_settlements" ADD CONSTRAINT "sales_return_settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_store_credit_transactions" ADD CONSTRAINT "customer_store_credit_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_store_credit_transactions" ADD CONSTRAINT "customer_store_credit_transactions_sales_return_id_fkey" FOREIGN KEY ("sales_return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_store_credit_transactions" ADD CONSTRAINT "customer_store_credit_transactions_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_store_credit_transactions" ADD CONSTRAINT "customer_store_credit_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
