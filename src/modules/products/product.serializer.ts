import { resolveEffectiveDefaultBatch } from "./product-default.js";

export const productSerializer = (p: any) => {
  const batches = p?.inventoryBatches ?? [];
  const effectiveDefault = resolveEffectiveDefaultBatch(batches);
  return {
    ...p,
    purchaseRate: p.purchaseRate.toString(),
    sellingPrice: (effectiveDefault?.sellingRate ?? p.sellingPrice).toString(),
    mrp: (effectiveDefault ? effectiveDefault.mrp : p.mrp)?.toString() ?? null,
    currentStock: p.currentStock.toString(),
    brand: p?.brand?.name,
    unit: p?.unit?.symbol || p?.unit?.name,
    unitId: p?.unit?.id ?? p.unitId,
    unitName: p?.unit?.name,
    unitSymbol: p?.unit?.symbol ?? null,
    unitAllowsDecimals: p?.unit?.allowsDecimals,
    batches: batches.map((batch: any) => ({
      id: batch.id,
      label: batch.label,
      purchaseRate: batch.purchaseRate.toString(),
      sellingRate: batch.sellingRate.toString(),
      mrp: batch.mrp?.toString() ?? null,
      isDefaultSellingRate: batch.id === effectiveDefault?.id,
      receivedQuantity: batch.receivedQuantity.toString(),
      remainingQuantity: batch.remainingQuantity.toString(),
      receivedAt: batch.receivedAt,
      source: batch.source,
    })),
  };
};
