import { z } from "zod";
export const customerPaymentSchema = z.object({
  customerId: z.uuid().optional(),
  saleId: z.uuid(),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  paymentDate: z.coerce.date().optional(),
  method: z.enum(["CASH", "UPI", "COUPON"]),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((payment, ctx) => {
  if (payment.method !== "COUPON") return;
  const match = /^Coupon code: (.+)$/.exec(payment.notes ?? "");
  if (!match || match[1].trim() !== match[1].trim().toUpperCase()) {
    ctx.addIssue({ code: "custom", path: ["notes"], message: "A normalized coupon code is required for coupon payments" });
  }
});
export const supplierPaymentSchema = z.object({
  supplierId: z.uuid(),
  purchaseId: z.uuid(),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  paymentDate: z.coerce.date().optional(),
  method: z.enum(["CASH", "UPI"]),
  notes: z.string().trim().max(1000).optional(),
});
