import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import { validate } from "../../shared/validate.js";
import * as controller from "./credit-bill.controller.js";
import { createCreditBillPaymentSchema, createCreditBillSchema, creditBillIdSchema } from "./credit-bill.schema.js";

const router = Router();
router.use(authenticate);
router.get("/", controller.list);
router.post("/", validate("body", createCreditBillSchema), controller.create);
router.post("/:id/payments", validate("params", creditBillIdSchema), validate("body", createCreditBillPaymentSchema), controller.pay);
export default router;
