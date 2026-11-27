CREATE TABLE "product_update_operations" (
  "idempotency_key" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_update_operations_pkey" PRIMARY KEY ("idempotency_key"),
  CONSTRAINT "product_update_operations_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "product_update_operations_product_id_created_at_idx"
  ON "product_update_operations"("product_id", "created_at");
