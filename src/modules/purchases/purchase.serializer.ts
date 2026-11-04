export const purchaseSerializer = (purchase: any) => ({
  ...purchase,
  items: purchase.items?.map((item: any) => ({
    ...item,
    quantity: item.quantity.toString(),
    unitId: item.product?.unit?.id,
    unitName: item.product?.unit?.name,
    unitSymbol: item.product?.unit?.symbol ?? null,
    unitAllowsDecimals: item.product?.unit?.allowsDecimals,
    product: item.product && {
      ...item.product,
      unitId: item.product.unit.id,
      unitName: item.product.unit.name,
      unitSymbol: item.product.unit.symbol ?? null,
      unitAllowsDecimals: item.product.unit.allowsDecimals,
    },
  })),
});
