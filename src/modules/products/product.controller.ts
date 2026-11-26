import type { Request, Response } from "express";
import * as service from "./product.service.js";
export const list = async (req: Request, res: Response) =>
  res.json({ success: true, ...(await service.listProducts(req.query)) });
export const get = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.getProduct(req.params.id as string),
  });
export const create = async (req: Request, res: Response) =>
  res
    .status(201)
    .json({
      success: true,
      data: await service.createProduct(req.body, req.user!.id),
    });
export const update = async (req: Request, res: Response) =>
  res.json({
    success: true,
    data: await service.updateProduct(req.params.id as string, req.body, req.user!.id, req.user!.role),
  });
