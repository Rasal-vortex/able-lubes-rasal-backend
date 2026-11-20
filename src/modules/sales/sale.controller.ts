import type { Request, Response } from "express";
import * as service from "./sale.service.js";
import * as returnService from "./sales-return.service.js";
export const get = async (req: Request, res: Response) =>
  res.json({ success: true, data: await returnService.getSaleForReturn(req.params.id as string) });
export const returnItems = async (req: Request, res: Response) =>
  res.status(201).json({ success: true, data: await returnService.createSalesReturn(req.params.id as string, req.body, req.user!.id) });
export const settleReturn = async (req: Request, res: Response) =>
  res.json({ success: true, data: await returnService.settlePendingSalesReturn(req.params.id as string, req.body, req.user!.id) });
export const create = async (req: Request, res: Response) =>
  res
    .status(201)
    .json({ success: true, data: await service.createSale(req.body) });
export const update = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.updateSaleCoupon(
      req.params.id as string,
      req.body,
    ),
  });
export const cancel = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.cancelSale(req.params.id as string, req.body, req.user!.id),
  });
