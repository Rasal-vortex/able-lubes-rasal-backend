import { z } from "zod";
export const purchaseIdSchema = z.object({ id: z.uuid() });
const purchaseLineSchema = z.object({
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
  supplierRate: z.coerce.number().finite().min(0.01).max(9999999999.99),
  sellingRate: z.coerce.number().finite().min(0.01).max(9999999999.99),
});
export const createPurchaseSchema = z.object({
  idempotencyKey: z.uuid(),
  supplierId: z.uuid(),
  supplierInvoiceNumber: z.string().trim().max(100).optional(),
  purchaseDate: z.coerce.date().optional(),
  discountAmount: z.coerce.number().finite().min(0).default(0),
  items: z.array(purchaseLineSchema).min(1).max(100),
});

const supplierRefundLineSchema = z.object({
  originalPaymentId: z.uuid(),
  amount: z.coerce.number().finite().gt(0).max(9999999999.99),
  method: z.enum(["CASH", "UPI", "BANK", "OTHER"]),
  reference: z.string().trim().max(120).optional(),
});

export const cancelPurchaseSchema = z.object({
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(1).max(500),
  paymentGroupDecisions: z.array(z.object({
    paymentGroupId: z.uuid().nullable().optional(),
    paymentId: z.uuid().optional(),
    wasTransferred: z.boolean(),
  }).refine((decision) => Boolean(decision.paymentGroupId) !== Boolean(decision.paymentId), {
    message: "Provide exactly one payment group ID or payment ID",
  })).max(100).default([]),
  refundNow: z.array(supplierRefundLineSchema).max(10).default([]),
  refundPending: z.array(z.object({
    originalPaymentId: z.uuid(),
    amount: z.coerce.number().finite().gt(0).max(9999999999.99),
  })).max(10).default([]),
  refundDate: z.coerce.date().optional(),
});

export const settleSupplierRefundSchema = z.object({
  idempotencyKey: z.uuid(),
  settledAt: z.coerce.date().optional(),
  refunds: z.array(supplierRefundLineSchema).min(1).max(10),
});
