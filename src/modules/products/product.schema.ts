import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";
const money = z.coerce.number().finite().min(0).max(9999999999.99);
export const productIdSchema = z.object({ id: z.uuid() });
export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  brandId: z.uuid(),
  unitId: z.uuid(),
  sellingPrice: money,
  mrp: money.optional().nullable(),
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
  active: z.boolean().optional(),
});
export const updateProductSchema = createProductSchema
  .omit({ qty: true })
  .partial();
export const productListSchema = paginationSchema.extend({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
});
