export const saleSerializer = (sale: any) => ({
  ...sale,
  items: sale.items?.map((item: any) => ({
    ...item,
    quantity: item.quantity.toString(),
    displayQuantity: item.displayQuantity?.toString() ?? null,
    displayUnitName: item.displayUnitNameSnapshot ?? null,
    displayUnitSymbol: item.displayUnitSymbolSnapshot ?? null,
    unitId: item.product?.unit?.id,
    unitName: item.unitNameSnapshot ?? item.product?.unit?.name,
    unitSymbol: item.unitSymbolSnapshot ?? item.product?.unit?.symbol ?? null,
    unitAllowsDecimals: item.unitAllowsDecimalsSnapshot ?? item.product?.unit?.allowsDecimals,
    product: item.product && {
      ...item.product,
      purchaseRate: item.product.purchaseRate.toString(),
      sellingPrice: item.product.sellingPrice.toString(),
      mrp: item.product.mrp?.toString() ?? null,
      unitId: item.product.unit.id,
      unitName: item.product.unit.name,
      unitSymbol: item.product.unit.symbol ?? null,
      unitAllowsDecimals: item.product.unit.allowsDecimals,
    },
  })),
});
