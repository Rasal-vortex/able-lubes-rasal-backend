ALTER TABLE "sales" ADD COLUMN "idempotency_key" UUID;
ALTER TABLE "sales" ADD COLUMN "request_hash" VARCHAR(64);

CREATE UNIQUE INDEX "sales_idempotency_key_key" ON "sales"("idempotency_key");
