export type PurchaseCancellationRestrictionCode =
  | "PURCHASE_STATUS_NOT_POSTED"
  | "ORIGINAL_BATCH_UNAVAILABLE"
  | "BATCH_INACTIVE"
  | "STOCK_QUANTITY_CHANGED"
  | "SALES_HISTORY_EXISTS"
  | "STOCK_MOVEMENT_HISTORY_EXISTS";

type PurchaseCancellationBlocker = {
  code: PurchaseCancellationRestrictionCode;
  purchaseItemId: string | null;
  productId: string | null;
  productName: string | null;
  batchReference: string | null;
  purchasedQuantity: string | null;
  batchReceivedQuantity: string | null;
  currentAvailableQuantity: string | null;
  batchStatus: string | null;
  hasSalesHistory: boolean | null;
  hasStockMovementHistory: boolean | null;
  reason: string;
};

export function purchaseCancellationBlockers(purchase: any): PurchaseCancellationBlocker[] {
  if (purchase.status !== "POSTED")
    return [{
      code: "PURCHASE_STATUS_NOT_POSTED",
      purchaseItemId: null,
      productId: null,
      productName: null,
      batchReference: null,
      purchasedQuantity: null,
      batchReceivedQuantity: null,
      currentAvailableQuantity: null,
      batchStatus: null,
      hasSalesHistory: null,
      hasStockMovementHistory: null,
      reason: "Only posted purchases can be cancelled.",
    }];

  const blockers: PurchaseCancellationBlocker[] = [];
  for (const item of purchase.items ?? []) {
    const batch = item.inventoryBatch;
    const productName = item.product?.name ?? "A product";
    const batchMatchesPurchaseItem = Boolean(
      batch && batch.productId === item.productId && batch.purchaseItemId === item.id && batch.source === "PURCHASE",
    );
    const add = (code: PurchaseCancellationRestrictionCode, reason: string) => blockers.push({
      code,
      purchaseItemId: item.id ?? null,
      productId: item.productId ?? null,
      productName,
      batchReference: batchMatchesPurchaseItem ? batch.label?.trim() || null : null,
      purchasedQuantity: item.quantity?.toString?.() ?? null,
      batchReceivedQuantity: batchMatchesPurchaseItem ? batch.receivedQuantity?.toString?.() ?? null : null,
      currentAvailableQuantity: batchMatchesPurchaseItem ? batch.remainingQuantity?.toString?.() ?? null : null,
      batchStatus: batchMatchesPurchaseItem ? batch.status ?? null : null,
      hasSalesHistory: batchMatchesPurchaseItem ? Boolean(batch.saleItems?.length) : null,
      hasStockMovementHistory: batchMatchesPurchaseItem ? Boolean(batch.stockMovements?.length) : null,
      reason,
    });
    if (!batch || batch.productId !== item.productId || batch.purchaseItemId !== item.id || batch.source !== "PURCHASE") {
      add("ORIGINAL_BATCH_UNAVAILABLE", "its original purchase batch is missing or does not match.");
      continue;
    }
    if (batch.status !== "ACTIVE") add("BATCH_INACTIVE", "its original batch is no longer active.");
    if (!batch.remainingQuantity.eq(batch.receivedQuantity)) add("STOCK_QUANTITY_CHANGED", "some of its purchased stock is no longer available.");
    if (batch.saleItems?.length) add("SALES_HISTORY_EXISTS", "its batch has sale or return history.");
    if (batch.stockMovements?.length) add("STOCK_MOVEMENT_HISTORY_EXISTS", "its batch has stock adjustment or movement history.");
  }
  return blockers;
}
