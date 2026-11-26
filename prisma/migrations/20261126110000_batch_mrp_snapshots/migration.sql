ALTER TABLE "inventory_batches"
ADD COLUMN "mrp" DECIMAL(12,2);

ALTER TABLE "sale_items"
ADD COLUMN "historical_mrp_snapshot" DECIMAL(12,2);
