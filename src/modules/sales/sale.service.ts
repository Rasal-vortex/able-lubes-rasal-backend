import {
  createSale as postSale,
  cancelSale as reverseSale,
  updateSaleCoupon as patchSaleCoupon,
} from "../transactions/transaction.service.js";
import { saleSerializer } from "./sale.serializer.js";
export const createSale = async (data: any) =>
  saleSerializer(await postSale(data));
export const updateSaleCoupon = async (id: string, data: any) =>
  saleSerializer(await patchSaleCoupon(id, data));
export const cancelSale = async (id: string) =>
  saleSerializer(await reverseSale(id));
