import { z } from "zod";

export const createCreditBillSchema = z.object({
  customerId: z.uuid(),
  billNumber: z.string().trim().min(1).max(80),
  billDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  term: z.string().trim().min(1).max(80),
  billAmount: z.coerce.number().finite().positive().max(9999999999.99),
  priorBalance: z.coerce.number().finite().min(0).max(9999999999.99).default(0),
  remarks: z.string().trim().max(1000).optional(),
});

export const creditBillIdSchema = z.object({ id: z.uuid() });

export const createCreditBillPaymentSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  paymentDate: z.coerce.date().optional(),
  method: z.enum(["CASH", "UPI"]),
  notes: z.string().trim().max(1000).optional(),
});

const refundLineSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9999999999.99).refine((value) => Number.isInteger(value * 100), "Refund amount supports up to two decimal places"),
  method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
  reference: z.string().trim().max(120).optional(),
  originalPaymentId: z.uuid().optional(),
});

const actualPaymentLineSchema = z.object({
  amount: z.coerce.number().finite().min(0).max(9999999999.99).refine((value) => Number.isInteger(value * 100), "Payment amount supports up to two decimal places"),
  method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
});

export const cancelBillingCreditSaleSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  refundMode: z.enum(["PENDING", "NOW"]),
  refunds: z.array(refundLineSchema).max(20).default([]),
  // Requiring an explicit set of amounts prevents recorded receipts from being
  // silently treated as money actually received when staff cancels a credit sale.
  actualPayments: z.array(actualPaymentLineSchema).max(20),
  actualReceivedConfirmed: z.literal(true),
}).superRefine((input, ctx) => {
  if (input.refundMode === "PENDING" && input.refunds.length) {
    ctx.addIssue({ code: "custom", path: ["refunds"], message: "Pending mode must not record money as already refunded" });
  }
  const verifiedAmount = input.actualPayments?.reduce((total, payment) => total + payment.amount, 0);
  if (input.refundMode === "NOW" && !input.refunds.length && (verifiedAmount === undefined || verifiedAmount > 0)) {
    ctx.addIssue({ code: "custom", path: ["refunds"], message: "Enter at least one actual refund or choose pending" });
  }
});

export const settleCreditRefundSchema = z.object({
  amount: z.coerce.number().finite().positive().max(9999999999.99).refine((value) => Number.isInteger(value * 100), "Refund amount supports up to two decimal places"),
  method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
  reference: z.string().trim().max(120).optional(),
  idempotencyKey: z.uuid(),
  originalPaymentId: z.uuid().optional(),
});
