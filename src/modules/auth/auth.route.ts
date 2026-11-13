import { Router } from "express";
import { createUserController, loginController, logoutController, refreshController } from "./auth.controller.js";
import { createUserSchema, loginSchema } from "./auth.schema.js";
import { validate } from "../../shared/validate.js";
import { authenticate, authorize } from "../../middlewares/auth.js";
const router = Router();
router.post("/login", validate("body", loginSchema), loginController);
router.post("/refresh", refreshController);
router.post("/logout", logoutController);
router.post(
  "/users",
  authenticate,
  authorize("ADMIN"),
  validate("body", createUserSchema),
  createUserController,
);
export default router;
