import type { Request, Response } from "express";
import * as service from "./sale.service.js";
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
    data: await service.cancelSale(req.params.id as string),
  });
