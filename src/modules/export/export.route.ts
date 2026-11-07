import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth.js";
import {
  createDatabaseExportLink,
  downloadDatabaseExport,
} from "./export.controller.js";

const router = Router();
router.use(authenticate, authorize("ADMIN"));
router.get("/database", createDatabaseExportLink);
router.get("/database/download", downloadDatabaseExport);

export default router;
