import { Router } from "express";
import * as c from "./coupon.controller.js";
import {
  couponIdSchema,
  couponListSchema,
  createCouponSchema,
  updateCouponSchema,
} from "./coupon.schema.js";
import { authenticate } from "../../middlewares/auth.js";
import { validate } from "../../shared/validate.js";

const router = Router();
router.use(authenticate);
router.get("/", validate("query", couponListSchema), c.list);
router.get("/:id", validate("params", couponIdSchema), c.get);
router.post("/", validate("body", createCouponSchema), c.create);
router.patch(
  "/:id",
  validate("params", couponIdSchema),
  validate("body", updateCouponSchema),
  c.update,
);
router.delete("/:id", validate("params", couponIdSchema), c.remove);
export default router;
