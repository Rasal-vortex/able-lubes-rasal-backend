import { Router } from "express";
import { authenticate } from "../../middlewares/auth.js";
import { validate } from "../../shared/validate.js";
import * as controller from "./dashboard.controller.js";
import { dashboardQuerySchema } from "./dashboard.schema.js";

const router = Router();
router.use(authenticate);
router.get("/summary", validate("query", dashboardQuerySchema), controller.summary);
export default router;
