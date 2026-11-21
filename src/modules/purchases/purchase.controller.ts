import type { Request, Response } from "express";
import * as service from "./purchase.service.js";
export const create = async (req: Request, res: Response) =>
  res
    .status(201)
    .json({ success: true, data: await service.createPurchase(req.body) });
export const cancel = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.cancelPurchase(req.params.id as string, req.body, req.user!.id),
  });
export const settleRefund = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.settleSupplierRefund(req.params.id as string, req.body, req.user!.id),
  });
