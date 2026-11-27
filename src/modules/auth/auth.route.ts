import { Router } from "express";
import { createUserController, loginController, logoutController, refreshController } from "./auth.controller.js";
import { createUserSchema, loginSchema } from "./auth.schema.js";
import { validate } from "../../shared/validate.js";
import { authenticate, authorize } from "../../middlewares/auth.js";
import { rateLimit } from "express-rate-limit";
const router = Router();
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

router.post(
  "/login",
  loginRateLimiter,
  validate("body", loginSchema),
  loginController,
);
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
