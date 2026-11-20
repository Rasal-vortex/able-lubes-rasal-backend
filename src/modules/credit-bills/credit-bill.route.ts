import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import { validate } from "../../shared/validate.js";
import * as controller from "./credit-bill.controller.js";
import { cancelBillingCreditSaleSchema, createCreditBillPaymentSchema, createCreditBillSchema, creditBillIdSchema, settleCreditRefundSchema } from "./credit-bill.schema.js";

const router = Router();
router.use(authenticate);
router.get("/", controller.list);
router.post("/", validate("body", createCreditBillSchema), controller.create);
router.post("/:id/payments", validate("params", creditBillIdSchema), validate("body", createCreditBillPaymentSchema), controller.pay);
router.post("/:id/cancel", validate("params", creditBillIdSchema), validate("body", cancelBillingCreditSaleSchema), controller.cancelSale);
router.post("/:id/refunds", validate("params", creditBillIdSchema), validate("body", settleCreditRefundSchema), controller.settleRefund);
router.delete("/:id", validate("params", creditBillIdSchema), controller.remove);
export default router;
