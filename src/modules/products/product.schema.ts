import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";
const money = z.coerce.number().finite().min(0).max(9999999999.99);
const positiveRate = money.min(0.01).refine(
  (value) => Number.isInteger(value * 100),
  "Rate supports up to two decimal places",
);
const quantity = z.union([
  z.number().finite(),
  z.string().trim().regex(/^\d+(\.\d+)?$/),
]).refine((value) => Number(value) > 0 && Number(value) <= 999999999, "Quantity must be positive and within the supported range");
const nonNegativeQuantity = z.union([
  z.number().finite(),
  z.string().trim().regex(/^\d+(\.\d+)?$/),
]).refine((value) => Number(value) >= 0 && Number(value) <= 999999999, "Quantity must be non-negative and within the supported range");
const batchMrp = money.nullable().optional();
const newBatchSchema = z.object({
  clientKey: z.string().trim().min(1).max(80).optional(),
  quantity,
  purchaseRate: positiveRate,
  sellingRate: positiveRate,
  mrp: batchMrp,
});
const createBatchSchema = newBatchSchema.extend({ isDefaultSellingRate: z.boolean() });
const batchUpdateSchema = z.object({
  id: z.uuid(),
  expectedRemainingQuantity: nonNegativeQuantity.optional(),
  remainingQuantity: nonNegativeQuantity.optional(),
  sellingRate: positiveRate.optional(),
  mrp: batchMrp,
}).refine(
  (batch) => batch.remainingQuantity === undefined || batch.expectedRemainingQuantity !== undefined,
  { message: "Refresh product data before reducing batch stock", path: ["expectedRemainingQuantity"] },
).refine(
  (batch) => batch.remainingQuantity !== undefined || batch.sellingRate !== undefined || batch.mrp !== undefined,
  { message: "Provide at least one batch field to update" },
);
export const productIdSchema = z.object({ id: z.uuid() });
const productFields = z.object({
  name: z.string().trim().min(1).max(160),
  brandId: z.uuid(),
  unitId: z.uuid(),
  purchaseRate: money.min(0.01),
  sellingPrice: money,
  mrp: money.nullable().optional(),
  qty: nonNegativeQuantity.default(0),
  active: z.boolean().optional(),
});
export const createProductSchema = productFields.extend({
  batches: z.array(createBatchSchema).min(1).max(50).optional(),
}).superRefine((product, ctx) => {
  if (product.batches) {
    const defaultCount = product.batches.filter((batch) => batch.isDefaultSellingRate).length;
    if (defaultCount !== 1) ctx.addIssue({ code: "custom", path: ["batches"], message: "Select exactly one default selling rate" });
    const clientKeys = product.batches.map((batch) => batch.clientKey).filter(Boolean);
    if (clientKeys.some((key) => clientKeys.filter((candidate) => candidate === key).length > 1)) {
      ctx.addIssue({ code: "custom", path: ["batches"], message: "Batch references must be unique" });
    }
    for (const [index, batch] of product.batches.entries()) {
      if (batch.mrp != null && batch.mrp <= batch.sellingRate) {
        ctx.addIssue({ code: "custom", path: ["batches", index, "mrp"], message: "MRP must be greater than selling price" });
      }
    }
    const batchTotal = product.batches.reduce((sum, batch) => sum + Number(batch.quantity), 0);
    if (Math.abs(batchTotal - Number(product.qty)) > 0.0000001) {
      ctx.addIssue({ code: "custom", path: ["qty"], message: "Initial stock must equal the sum of batch quantities" });
    }
  }
  if (product.mrp != null && product.mrp <= product.sellingPrice) {
    ctx.addIssue({ code: "custom", path: ["mrp"], message: "MRP must be greater than selling price" });
  }
});
const batchPricingSchema = z.object({
  updates: z.array(batchUpdateSchema).max(100).default([]),
  additions: z.array(newBatchSchema).max(50).default([]),
  defaultBatchKey: z.string().trim().min(1).max(80).nullable(),
}).superRefine((batchPricing, ctx) => {
  const updateIds = batchPricing.updates.map((batch) => batch.id);
  if (new Set(updateIds).size !== updateIds.length) {
    ctx.addIssue({ code: "custom", path: ["updates"], message: "Each existing batch can only be updated once" });
  }
  const clientKeys = batchPricing.additions.map((batch) => batch.clientKey).filter(Boolean);
  if (clientKeys.some((key) => clientKeys.filter((candidate) => candidate === key).length > 1)) {
    ctx.addIssue({ code: "custom", path: ["additions"], message: "New batch references must be unique" });
  }
  for (const [index, batch] of batchPricing.updates.entries()) {
    if (batch.mrp != null && batch.sellingRate !== undefined && batch.mrp <= batch.sellingRate) {
      ctx.addIssue({ code: "custom", path: ["updates", index, "mrp"], message: "MRP must be greater than selling price" });
    }
  }
  for (const [index, batch] of batchPricing.additions.entries()) {
    if (batch.mrp != null && batch.mrp <= batch.sellingRate) {
      ctx.addIssue({ code: "custom", path: ["additions", index, "mrp"], message: "MRP must be greater than selling price" });
    }
  }
});
export const updateProductSchema = productFields
  .omit({ qty: true })
  .partial()
  .extend({ batchPricing: batchPricingSchema.optional(), idempotencyKey: z.uuid().optional() })
  .superRefine((product, ctx) => {
    if (product.batchPricing && !product.idempotencyKey) {
      ctx.addIssue({ code: "custom", path: ["idempotencyKey"], message: "An idempotency key is required for batch updates" });
    }
    if (
      product.mrp != null &&
      product.sellingPrice !== undefined &&
      product.mrp <= product.sellingPrice
    ) {
      ctx.addIssue({ code: "custom", path: ["mrp"], message: "MRP must be greater than selling price" });
    }
  });
export const productListSchema = paginationSchema.extend({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
});
