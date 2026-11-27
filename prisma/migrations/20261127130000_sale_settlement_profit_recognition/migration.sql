ALTER TABLE "sales"
ADD COLUMN "settled_at" TIMESTAMPTZ(3);

CREATE INDEX "sales_settled_at_idx" ON "sales"("settled_at");
