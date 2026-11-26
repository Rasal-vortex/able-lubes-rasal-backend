export function purchaseCancellationBlockers(purchase: any) {
  if (purchase.status !== "POSTED")
    return [{ productId: null, productName: null, reason: "Only posted purchases can be cancelled." }];

  const blockers: Array<{ productId: string; productName: string; reason: string }> = [];
  for (const item of purchase.items ?? []) {
    const batch = item.inventoryBatch;
    const productName = item.product?.name ?? "A product";
    const add = (reason: string) => blockers.push({ productId: item.productId, productName, reason });
    if (!batch || batch.productId !== item.productId || batch.purchaseItemId !== item.id || batch.source !== "PURCHASE") {
      add("its original purchase batch is missing or does not match.");
      continue;
    }
    if (batch.status !== "ACTIVE") add("its original batch is no longer active.");
    if (!batch.remainingQuantity.eq(batch.receivedQuantity)) add("some of its purchased stock is no longer available.");
    if (batch.saleItems?.length) add("its batch has sale or return history.");
    if (batch.stockMovements?.length) add("its batch has stock adjustment or movement history.");
  }
  return blockers;
}
