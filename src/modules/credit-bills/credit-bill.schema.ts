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
