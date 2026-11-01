import type { Request, Response } from "express";
import * as service from "./coupon.service.js";

export const list = async (req: Request, res: Response) =>
  res.json({ success: true, ...(await service.listCoupons(req.query)) });
export const get = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.getCoupon(req.params.id as string),
  });
export const create = async (req: Request, res: Response) =>
  res
    .status(201)
    .json({ success: true, data: await service.createCoupon(req.body) });
export const update = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.updateCoupon(req.params.id as string, req.body),
  });
export const remove = async (req: Request, res: Response) => {
  await service.deleteCoupon(req.params.id as string);
  return res.status(204).send();
};
