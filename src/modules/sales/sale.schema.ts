import { z } from "zod";
export const saleIdSchema = z.object({ id: z.uuid() });
const saleLineSchema = z.object({
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
      (v) => Number(v) > 0 && Number(v) <= 999999,
      "Quantity must be positive and within the supported range",
    ),
  displayQuantity: z.coerce.number().finite().int().positive().max(999999999).optional(),
  displayUnitName: z.literal("Gram").optional(),
  displayUnitSymbol: z.literal("g").optional(),
  discountAmount: z.coerce.number().finite().min(0).default(0),
}).refine((line) => {
  const anyDisplayField = line.displayQuantity !== undefined || line.displayUnitName !== undefined || line.displayUnitSymbol !== undefined;
  const allDisplayFields = line.displayQuantity !== undefined && line.displayUnitName !== undefined && line.displayUnitSymbol !== undefined;
  return !anyDisplayField || allDisplayFields;
}, { message: "Gram display quantity and unit must be provided together", path: ["displayQuantity"] });
export const createSaleSchema = z
  .object({
    customerId: z.uuid().optional().nullable(),
    billDate: z.coerce.date().optional(),
    discountAmount: z.coerce.number().finite().min(0).default(0),
    couponCode: z.string().trim().min(1).max(80).toUpperCase().optional(),
    couponPrice: z.coerce
      .number()
      .finite()
      .positive()
      .max(9999999999.99)
      .optional(),
    items: z.array(saleLineSchema).min(1).max(100),
  })
  .refine((x) => Boolean(x.couponCode) === (x.couponPrice !== undefined), {
    message: "couponCode and couponPrice must be provided together",
  });
export const updateSaleCouponSchema = z.object({
  couponCode: z.string().trim().min(1).max(80).toUpperCase(),
  couponPrice: z.coerce.number().finite().positive().max(9999999999.99),
});
