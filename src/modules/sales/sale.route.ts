import { Router } from "express";
import * as c from "./sale.controller.js";
import {
  createSaleSchema,
  saleIdSchema,
  updateSaleCouponSchema,
  cancelSaleSchema,
} from "./sale.schema.js";
import { createSalesReturnSchema, salesReturnParamsSchema, settleSalesReturnSchema } from "./sales-return.schema.js";
import { authenticate, authorize } from "../../middlewares/auth.js";
import { validate } from "../../shared/validate.js";
const router = Router();
router.use(authenticate);
router.post("/", validate("body", createSaleSchema), c.create);
router.post("/returns/:id/settlements", validate("params", salesReturnParamsSchema), validate("body", settleSalesReturnSchema), c.settleReturn);
router.get("/:id", validate("params", saleIdSchema), c.get);
router.post("/:id/returns", validate("params", saleIdSchema), validate("body", createSalesReturnSchema), c.returnItems);
router.patch(
  "/:id",
  validate("params", saleIdSchema),
  validate("body", updateSaleCouponSchema),
  c.update,
);
router.post(
  "/:id/cancel",
  authorize("ADMIN"),
  validate("params", saleIdSchema),
  validate("body", cancelSaleSchema),
  c.cancel,
);
export default router;
