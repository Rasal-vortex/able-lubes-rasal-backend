export const productSerializer = (p: any) => ({
  ...p,
  purchaseRate: p.purchaseRate.toString(),
  sellingPrice: p.sellingPrice.toString(),
  mrp: p.mrp?.toString() ?? null,
  currentStock: p.currentStock.toString(),
  brand: p?.brand?.name,
  unit: p?.unit?.symbol || p?.unit?.name,
  unitId: p?.unit?.id ?? p.unitId,
  unitName: p?.unit?.name,
  unitSymbol: p?.unit?.symbol ?? null,
  unitAllowsDecimals: p?.unit?.allowsDecimals,
});
