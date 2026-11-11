import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";
export const expenseIdSchema = z.object({ id: z.uuid() });
export const createExpenseSchema = z.object({
  description: z.string().trim().max(300).optional().default(""),
  category: z.string().trim().min(1).max(100),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  expenseDate: z.coerce.date().optional(),
  paymentMethod: z.enum(["CASH", "UPI"]).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
export const updateExpenseSchema = createExpenseSchema.partial();
export const expenseListSchema = paginationSchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
