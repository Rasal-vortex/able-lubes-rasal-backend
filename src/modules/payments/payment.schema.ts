import { z } from "zod";
export const customerPaymentSchema = z.object({
  customerId: z.uuid().optional(),
  saleId: z.uuid(),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  paymentDate: z.coerce.date().optional(),
  method: z.enum(["CASH", "UPI", "COUPON"]),
  notes: z.string().trim().max(1000).optional(),
});
export const supplierPaymentSchema = z.object({
  supplierId: z.uuid(),
  purchaseId: z.uuid(),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  paymentDate: z.coerce.date().optional(),
  method: z.enum(["CASH", "UPI"]),
  notes: z.string().trim().max(1000).optional(),
});
