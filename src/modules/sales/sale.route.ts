import { Router } from "express";
import * as c from "./sale.controller.js";
import {
  createSaleSchema,
  saleIdSchema,
  updateSaleCouponSchema,
} from "./sale.schema.js";
import { authenticate, authorize } from "../../middlewares/auth.js";
import { validate } from "../../shared/validate.js";
const router = Router();
router.use(authenticate);
router.post("/", validate("body", createSaleSchema), c.create);
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
  c.cancel,
);
export default router;
