import { z } from "zod";
import { paginationSchema } from "../../shared/pagination.js";

const base = {
  name: z.string().trim().min(1).max(100),
  active: z.boolean().optional(),
};
export const catalogIdSchema = z.object({ id: z.uuid() });
export const brandSchema = z.object(base);
export const unitSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    symbol: z.string().trim().max(5).optional().nullable(),
    allowsDecimals: z.boolean().default(false),
  })
  .strict();
export const unitUpdateSchema = unitSchema.partial();
export const catalogListSchema = paginationSchema.extend({
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(true),
});
