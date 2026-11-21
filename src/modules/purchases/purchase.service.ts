import {
  createPurchase as postPurchase,
  cancelPurchase as reversePurchase,
  settleSupplierRefund as settlePurchaseRefund,
} from "../transactions/transaction.service.js";
import { purchaseSerializer } from "./purchase.serializer.js";
export const createPurchase = async (data: any) =>
  purchaseSerializer(await postPurchase(data));
export const cancelPurchase = async (id: string, input: any, userId: string) =>
  purchaseSerializer(await reversePurchase(id, input, userId));
export const settleSupplierRefund = (id: string, input: any, userId: string) =>
  settlePurchaseRefund(id, input, userId);
