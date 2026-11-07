import type { Request, Response } from "express";
import { dashboardSummary } from "./dashboard.service.js";

export const summary = async (req: Request, res: Response) =>
  res.json({ success: true, data: await dashboardSummary(req.query.month as string | undefined) });
