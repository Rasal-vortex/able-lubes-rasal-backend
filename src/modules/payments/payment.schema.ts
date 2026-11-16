import { z } from "zod";
export const customerPaymentSchema = z
  .object({
    customerId: z.uuid().optional(),
    saleId: z.uuid(),
    amount: z.coerce.number().finite().positive().max(9999999999.99),
    paymentDate: z.coerce.date().optional(),
    method: z.enum(["CASH", "UPI", "COUPON"]),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((payment, ctx) => {
    if (payment.method !== "COUPON") return;
    if (!payment.notes) return;
    const match = /^Coupon code: (.+)$/.exec(payment.notes ?? "");
    if (!match || match[1].trim() !== match[1].trim().toUpperCase()) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message:
          "Coupon notes must contain a normalized coupon code when provided",
      });
    }
  });
export const supplierPaymentSchema = z
  .object({
    supplierId: z.uuid(),
    purchaseId: z.uuid(),
    amount: z.coerce.number().finite().positive().max(9999999999.99).optional(),
    paymentDate: z.coerce.date().optional(),
    method: z.enum(["CASH", "UPI"]).optional(),
    tenders: z
      .array(
        z.object({
          method: z.enum(["CASH", "UPI"]),
          amount: z.coerce.number().finite().positive().max(9999999999.99),
        }),
      )
      .min(1)
      .max(2)
      .optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((payment, ctx) => {
    const hasLegacyPayment =
      payment.amount !== undefined || payment.method !== undefined;
    const hasTenderPayments = payment.tenders !== undefined;
    if (hasLegacyPayment === hasTenderPayments) {
      ctx.addIssue({
        code: "custom",
        path: ["tenders"],
        message: "Provide either amount and method or tenders",
      });
      return;
    }
    if (
      hasLegacyPayment &&
      (payment.amount === undefined || payment.method === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: [payment.amount === undefined ? "amount" : "method"],
        message: "Amount and method must be provided together",
      });
    }
    if (
      payment.tenders &&
      new Set(payment.tenders.map((tender) => tender.method)).size !==
        payment.tenders.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["tenders"],
        message: "Each payment method can appear only once",
      });
    }
  });
