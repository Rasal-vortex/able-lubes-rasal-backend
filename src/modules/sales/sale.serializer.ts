export const saleSerializer = (sale: any) => ({
  ...sale,
  items: sale.items?.map((item: any) => ({
    ...item,
    quantity: item.quantity.toString(),
    unitId: item.product?.unit?.id,
    unitName: item.product?.unit?.name,
    unitSymbol: item.product?.unit?.symbol ?? null,
    unitAllowsDecimals: item.product?.unit?.allowsDecimals,
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
