CREATE TYPE "InventoryBatchSource" AS ENUM ('PURCHASE', 'OPENING', 'ADJUSTMENT');
CREATE TYPE "InventoryBatchStatus" AS ENUM ('ACTIVE', 'DEPLETED', 'CANCELLED');
CREATE TYPE "SaleCostSource" AS ENUM ('VERIFIED_BATCH', 'LEGACY_ESTIMATE');

CREATE TABLE "inventory_batches" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "purchase_item_id" UUID,
    "label" TEXT,
    "received_quantity" DECIMAL(12,3) NOT NULL,
    "remaining_quantity" DECIMAL(12,3) NOT NULL,
    "purchase_rate" DECIMAL(12,2) NOT NULL,
    "selling_rate" DECIMAL(12,2) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "InventoryBatchSource" NOT NULL,
    "status" "InventoryBatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_batches_received_quantity_check" CHECK ("received_quantity" >= 0),
    CONSTRAINT "inventory_batches_remaining_quantity_check" CHECK ("remaining_quantity" >= 0 AND "remaining_quantity" <= "received_quantity"),
    CONSTRAINT "inventory_batches_purchase_rate_check" CHECK ("purchase_rate" >= 0),
    CONSTRAINT "inventory_batches_selling_rate_check" CHECK ("selling_rate" >= 0)
);

CREATE UNIQUE INDEX "inventory_batches_purchase_item_id_key" ON "inventory_batches"("purchase_item_id");
CREATE INDEX "inventory_batches_product_id_status_received_at_idx" ON "inventory_batches"("product_id", "status", "received_at");
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sale_items"
  ADD COLUMN "inventory_batch_id" UUID,
  ADD COLUMN "batch_selling_price_snapshot" DECIMAL(12,2),
  ADD COLUMN "cost_snapshot_source" "SaleCostSource";
CREATE INDEX "sale_items_inventory_batch_id_idx" ON "sale_items"("inventory_batch_id");
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_inventory_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements" ADD COLUMN "inventory_batch_id" UUID;
CREATE INDEX "stock_movements_inventory_batch_id_idx" ON "stock_movements"("inventory_batch_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_batch_id_fkey" FOREIGN KEY ("inventory_batch_id") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Do not infer historical purchase-to-sale allocations. Preserve current stock
-- as one explicitly unreconciled opening batch. Reconciliation may replace it
-- with multiple batches using the CSV template before stock operations resume.
INSERT INTO "inventory_batches" (
  "id", "product_id", "label", "received_quantity", "remaining_quantity",
  "purchase_rate", "selling_rate", "received_at", "source", "status", "updated_at"
)
SELECT gen_random_uuid(), p."id", 'Legacy opening stock - reconcile', p."current_stock", p."current_stock",
       p."purchase_rate", p."selling_price", CURRENT_TIMESTAMP, 'OPENING',
       CASE WHEN p."current_stock" > 0 THEN 'ACTIVE'::"InventoryBatchStatus" ELSE 'DEPLETED'::"InventoryBatchStatus" END,
       CURRENT_TIMESTAMP
FROM "products" p;

-- Freeze the current report fallback cost for legacy sale lines and flag it as
-- an estimate, preventing future product price changes from altering old P&L.
UPDATE "sale_items" si
SET "historical_cost_snapshot" = p."purchase_rate",
    "cost_snapshot_source" = 'LEGACY_ESTIMATE'
FROM "products" p
WHERE si."product_id" = p."id" AND si."historical_cost_snapshot" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "products" p
    LEFT JOIN (SELECT "product_id", SUM("remaining_quantity") AS remaining FROM "inventory_batches" GROUP BY "product_id") b
      ON b."product_id" = p."id"
    WHERE COALESCE(b.remaining, 0) <> p."current_stock"
  ) THEN
    RAISE EXCEPTION 'Batch migration did not preserve aggregate product stock';
  END IF;
END $$;
