import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";
const positiveRate = z.coerce
  .number()
  .finite()
  .min(0.01)
  .max(9999999999.99)
  .refine(
    (value) => Number.isInteger(value * 100),
    "Rate supports up to 2 decimal places",
  );
export const adjustmentSchema = z
  .object({
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
    inventoryBatchId: z.uuid().optional(),
    purchaseRate: positiveRate.optional(),
    sellingRate: positiveRate.optional(),
    mrp: z.union([positiveRate, z.null()]).optional(),
    reason: z.string().trim().max(200).optional().default(""),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((value, context) => {
    if (value.direction === "IN") {
      if (value.inventoryBatchId)
        context.addIssue({
          code: "custom",
          path: ["inventoryBatchId"],
          message: "Do not select a batch for stock increases",
        });
      for (const field of ["purchaseRate", "sellingRate"] as const) {
        if (value[field] === undefined)
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field === "purchaseRate" ? "Purchase" : "Selling"} rate must be greater than zero`,
          });
      }
      if (value.mrp != null && value.sellingRate !== undefined && value.mrp <= value.sellingRate)
        context.addIssue({ code: "custom", path: ["mrp"], message: "MRP must be greater than the batch selling rate" });
    } else {
      if (!value.inventoryBatchId)
        context.addIssue({
          code: "custom",
          path: ["inventoryBatchId"],
          message: "Select the batch whose stock is being reduced",
        });
      if (value.purchaseRate !== undefined || value.sellingRate !== undefined || value.mrp !== undefined)
        context.addIssue({
          code: "custom",
          path: ["purchaseRate"],
          message: "Prices are only entered when increasing stock",
        });
    }
  });
export const movementListSchema = paginationSchema.extend({
  productId: z.uuid().optional(),
});
