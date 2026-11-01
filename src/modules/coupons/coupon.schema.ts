import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";

const couponCode = z.string().trim().min(1).max(80).toUpperCase();
const couponPrice = z.coerce.number().finite().positive().max(9999999999.99);
export const couponIdSchema = z.object({ id: z.uuid() });
export const createCouponSchema = z.object({
  code: couponCode,
  price: couponPrice,
});
export const updateCouponSchema = createCouponSchema.partial();
export const couponListSchema = paginationSchema.extend({
  type: z.enum(["all", "sales-based", "non-sale-based"]).default("all"),
});
