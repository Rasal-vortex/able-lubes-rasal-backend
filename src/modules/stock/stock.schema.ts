import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";
export const adjustmentSchema = z.object({
  productId: z.uuid(),
  quantity: z
    .union([
      z.number().finite(),
      z
        .string()
        .trim()
        .regex(/^\d+(\.\d+)?$/),
    ])
    .refine(
      (v) => Number(v) > 0 && Number(v) <= 999999999,
      "Quantity must be positive and within the supported range",
    ),
  direction: z.enum(["IN", "OUT"]),
  reason: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export const movementListSchema = paginationSchema.extend({
  productId: z.uuid().optional(),
});
