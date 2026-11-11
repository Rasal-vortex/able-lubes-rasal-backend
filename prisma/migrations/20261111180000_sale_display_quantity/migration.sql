ALTER TABLE "sale_items"
  ADD COLUMN "display_quantity" DECIMAL(12,3),
  ADD COLUMN "display_unit_name_snapshot" TEXT,
  ADD COLUMN "display_unit_symbol_snapshot" TEXT;