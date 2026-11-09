ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'COUPON';

ALTER TABLE "sale_items"
  ADD COLUMN "unit_name_snapshot" TEXT,
  ADD COLUMN "unit_symbol_snapshot" VARCHAR(5),
  ADD COLUMN "unit_allows_decimals_snapshot" BOOLEAN;

UPDATE "sale_items" AS item
SET "unit_name_snapshot" = unit.name,
    "unit_symbol_snapshot" = unit.symbol,
    "unit_allows_decimals_snapshot" = unit.allows_decimals
FROM "products" AS product
JOIN "units" AS unit ON unit.id = product.unit_id
WHERE item.product_id = product.id;

ALTER TABLE "sale_items"
  ALTER COLUMN "unit_name_snapshot" SET NOT NULL,
  ALTER COLUMN "unit_allows_decimals_snapshot" SET NOT NULL;

ALTER TABLE "purchase_items"
  ADD COLUMN "unit_name_snapshot" TEXT,
  ADD COLUMN "unit_symbol_snapshot" VARCHAR(5),
  ADD COLUMN "unit_allows_decimals_snapshot" BOOLEAN;

UPDATE "purchase_items" AS item
SET "unit_name_snapshot" = unit.name,
    "unit_symbol_snapshot" = unit.symbol,
    "unit_allows_decimals_snapshot" = unit.allows_decimals
FROM "products" AS product
JOIN "units" AS unit ON unit.id = product.unit_id
WHERE item.product_id = product.id;

ALTER TABLE "purchase_items"
  ALTER COLUMN "unit_name_snapshot" SET NOT NULL,
  ALTER COLUMN "unit_allows_decimals_snapshot" SET NOT NULL;
