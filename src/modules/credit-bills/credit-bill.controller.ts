import type { Request, Response } from "express";
import * as service from "./credit-bill.service.js";

export const list = async (_req: Request, res: Response) =>
  res.json({ success: true, data: await service.listCustomerCreditBills() });

export const create = async (req: Request, res: Response) =>
  res.status(201).json({ success: true, data: await service.createManualCreditBill(req.body) });

export const pay = async (req: Request, res: Response) =>
  res.json({ success: true, data: await service.recordManualCreditBillPayment(req.params.id as string, req.body) });
