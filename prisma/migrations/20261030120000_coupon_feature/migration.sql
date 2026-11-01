CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "is_sale_based" BOOLEAN NOT NULL DEFAULT false,
    "sale_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE UNIQUE INDEX "coupons_sale_id_key" ON "coupons"("sale_id");
CREATE INDEX "coupons_is_sale_based_idx" ON "coupons"("is_sale_based");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
