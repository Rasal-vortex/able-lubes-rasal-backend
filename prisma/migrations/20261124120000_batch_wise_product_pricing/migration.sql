ALTER TABLE "inventory_batches"
  ADD COLUMN "mrp" DECIMAL(12,2),
  ADD COLUMN "is_default_selling_rate" BOOLEAN NOT NULL DEFAULT FALSE;

-- Preserve the current product-level default price. Mark only a live batch whose
-- selling rate exactly matches it; leave unmatched legacy defaults unassigned.
WITH matching_batches AS (
  SELECT b."id",
         ROW_NUMBER() OVER (
           PARTITION BY b."product_id"
           ORDER BY b."received_at" DESC, b."id" DESC
         ) AS position
  FROM "inventory_batches" b
  JOIN "products" p ON p."id" = b."product_id"
  WHERE b."status" = 'ACTIVE'
    AND b."remaining_quantity" > 0
    AND b."selling_rate" = p."selling_price"
)
UPDATE "inventory_batches" b
SET "is_default_selling_rate" = TRUE
FROM matching_batches m
WHERE b."id" = m."id" AND m.position = 1;
