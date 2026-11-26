import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";
const money = z.coerce.number().finite().min(0).max(9999999999.99);
export const productIdSchema = z.object({ id: z.uuid() });
const productFields = z.object({
  name: z.string().trim().min(1).max(160),
  brandId: z.uuid(),
  unitId: z.uuid(),
  purchaseRate: money.min(0.01),
  sellingPrice: money,
  mrp: money.nullable().optional(),
  qty: z
    .union([
      z.number().finite(),
      z
        .string()
        .trim()
        .regex(/^\d+(\.\d+)?$/),
    ])
    .refine(
      (v) => Number(v) >= 0 && Number(v) <= 999999999,
      "Quantity must be non-negative and within the supported range",
    )
    .default(0),
  batches: z.array(z.object({
    clientKey: z.string().trim().min(1).max(120).optional(),
    label: z.string().trim().max(120).nullable().optional(),
    quantity: z.coerce.number().finite().gt(0).max(999999999),
    purchaseRate: money.min(0.01),
    sellingRate: money.min(0.01),
    mrp: money.nullable().optional(),
    isDefaultSellingRate: z.boolean().optional(),
  }).refine((batch) => batch.mrp == null || batch.mrp > batch.sellingRate, {
    message: "MRP must be greater than batch selling price",
    path: ["mrp"],
  })).min(1).optional(),
  batchPricing: z.object({
    updates: z.array(z.object({
      id: z.uuid(),
      label: z.string().trim().max(120).nullable().optional(),
      remainingQuantity: z.coerce.number().finite().min(0).max(999999999),
      sellingRate: money.min(0.01),
      mrp: money.nullable().optional(),
    }).refine((batch) => batch.mrp == null || batch.mrp > batch.sellingRate, {
      message: "MRP must be greater than batch selling price",
      path: ["mrp"],
    })).max(500),
    additions: z.array(z.object({
      clientKey: z.string().trim().min(1).max(120).optional(),
      label: z.string().trim().max(120).nullable().optional(),
      quantity: z.coerce.number().finite().gt(0).max(999999999),
      purchaseRate: money.min(0.01),
      sellingRate: money.min(0.01),
      mrp: money.nullable().optional(),
      isDefaultSellingRate: z.boolean().optional(),
    }).refine((batch) => batch.mrp == null || batch.mrp > batch.sellingRate, {
      message: "MRP must be greater than batch selling price",
      path: ["mrp"],
    })).max(500),
    defaultBatchKey: z.string().trim().min(1),
  }).optional(),
  active: z.boolean().optional(),
});
export const createProductSchema = productFields.superRefine((product, context) => {
  if (product.mrp != null && product.mrp <= product.sellingPrice) {
    context.addIssue({ code: "custom", message: "MRP must be greater than selling price", path: ["mrp"] });
  }
  if (product.batches) {
    const batchTotal = product.batches.reduce((sum, batch) => sum + batch.quantity, 0);
    if (Math.abs(batchTotal - Number(product.qty)) > 0.0005) {
      context.addIssue({ code: "custom", message: "Initial stock must equal the total quantity in its batches", path: ["batches"] });
    }
    if (product.batches.filter((batch) => batch.isDefaultSellingRate).length !== 1) {
      context.addIssue({ code: "custom", message: "Choose exactly one default selling price batch", path: ["batches"] });
    }
  }
});
export const updateProductSchema = productFields
  .omit({ qty: true })
  .partial()
  .refine(
    (product) =>
      product.mrp == null ||
      product.sellingPrice === undefined ||
      product.mrp > product.sellingPrice,
    { message: "MRP must be greater than selling price", path: ["mrp"] },
  );
export const productListSchema = paginationSchema.extend({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
});
