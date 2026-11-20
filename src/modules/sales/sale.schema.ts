import { z } from "zod";
export const saleIdSchema = z.object({ id: z.uuid() });
export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  refundMode: z.enum(["PENDING", "NOW"]),
  refunds: z.array(z.object({
    amount: z.coerce.number().finite().positive().max(9999999999.99).refine((value) => Number.isInteger(value * 100), "Refund amount supports up to two decimal places"),
    method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
    reference: z.string().trim().max(120).optional(),
    originalPaymentId: z.uuid().optional(),
  })).max(20).default([]),
}).superRefine((input, ctx) => {
  if (input.refundMode === "PENDING" && input.refunds.length)
    ctx.addIssue({ code: "custom", path: ["refunds"], message: "Pending mode must not record money as already refunded" });
  if (input.refundMode === "NOW" && !input.refunds.length)
    ctx.addIssue({ code: "custom", path: ["refunds"], message: "Enter at least one actual refund or choose pending" });
});
const saleLineSchema = z.object({
  productId: z.uuid(),
  inventoryBatchId: z.uuid(),
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
  unitSellingPrice: z.coerce.number().finite().min(0).max(9999999999.99).optional(),
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
    creditBill: z.object({
      billNumber: z.string().trim().min(1).max(80),
      dueDate: z.coerce.date(),
      term: z.string().trim().min(1).max(80),
      priorBalance: z.coerce.number().finite().min(0).max(9999999999.99).default(0),
    }).optional(),
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
