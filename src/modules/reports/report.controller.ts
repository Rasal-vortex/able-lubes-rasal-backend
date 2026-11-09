import type { Request, Response } from "express";
import * as s from "./report.service.js";
const range = (req: Request) =>
  [req.query.from as unknown as Date, req.query.to as unknown as Date] as [
    Date,
    Date,
  ];
export const sales = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.salesReport(...range(req)) });
export const purchases = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.purchaseReport(...range(req)) });
export const expenses = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.expenseReport(...range(req)) });
export const customers = async (_req: Request, res: Response) =>
  res.json({ success: true, data: await s.customerOutstanding() });
export const suppliers = async (_req: Request, res: Response) =>
  res.json({ success: true, data: await s.supplierOutstanding() });
export const monthly = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.monthlySummary(...range(req)) });
export const dailySales = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.dailySales(req.query.date as string) });
export const profit = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.profitReport(...range(req)) });
export const supplierLedger = async (req: Request, res: Response) =>
  res.json({ success: true, data: await s.supplierLedger(req.params.id as string) });
