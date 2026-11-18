CREATE TABLE "sale_invoice_counters" (
    "date_key" VARCHAR(6) NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_invoice_counters_pkey" PRIMARY KEY ("date_key")
);
