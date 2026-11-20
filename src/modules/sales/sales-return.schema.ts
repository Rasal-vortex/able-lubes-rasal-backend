import { z } from "zod";

const amount = z.coerce.number().finite().positive().max(9999999999.99)
  .refine((value) => Number.isInteger(value * 100), "Amounts support up to two decimal places");

export const salesReturnParamsSchema = z.object({ id: z.uuid() });

export const createSalesReturnSchema = z.object({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(1).max(1000),
  settlementType: z.enum(["REFUND", "CUSTOMER_CREDIT", "PENDING"]),
  items: z.array(z.object({ saleItemId: z.uuid(), quantity: amount.max(999999) })).min(1).max(100),
  refunds: z.array(z.object({
    amount,
    method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
    reference: z.string().trim().max(120).optional(),
  })).max(20).default([]),
}).superRefine((input, ctx) => {
  if (input.settlementType !== "REFUND" && input.refunds.length) {
    ctx.addIssue({ code: "custom", path: ["refunds"], message: "Refund payments are only accepted for Refund Now" });
  }
  const duplicateItems = input.items.map((item) => item.saleItemId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateItems.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Select each invoice product once and combine its return quantity" });
});

export const settleSalesReturnSchema = z.object({
  idempotencyKey: z.uuid(),
  refunds: z.array(z.object({
    amount,
    method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
    reference: z.string().trim().max(120).optional(),
  })).min(1).max(20),
});
