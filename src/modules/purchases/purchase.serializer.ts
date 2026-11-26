import { Prisma } from "../../../generated/prisma/client.js";

export const purchaseSerializer = (purchase: any) => ({
  ...purchase,
  creditApplied: purchase.status === "CANCELLED" ? "0.00" : (purchase.supplierCreditApplications ?? [])
    .filter((application: any) => !(application.reversals?.length))
    .reduce((sum: Prisma.Decimal, application: any) => sum.add(application.amount), new Prisma.Decimal(0))
    .toFixed(2),
  cancellation: purchase.cancellation ? (() => {
    const refund = purchase.cancellation.supplierRefund;
    const settled = refund?.settlements?.flatMap((settlement: any) => settlement.lines ?? [])
      .reduce((sum: Prisma.Decimal, line: any) => sum.add(line.amount), new Prisma.Decimal(0)) ?? new Prisma.Decimal(0);
    const pending = refund ? Prisma.Decimal.max(0, refund.amount.sub(settled)) : new Prisma.Decimal(0);
    return {
      id: purchase.cancellation.id,
      idempotencyKey: purchase.cancellation.idempotencyKey,
      reason: purchase.cancellation.reason,
      cancelledAt: purchase.cancellation.cancelledAt,
      refund: refund ? {
        id: refund.id,
        amount: refund.amount.toFixed(2),
        settled: settled.toFixed(2),
        pending: pending.toFixed(2),
        status: pending.isZero() ? "FULLY_REFUNDED" : settled.isZero() ? "REFUND_PENDING" : "PARTIALLY_REFUNDED",
      } : { amount: "0.00", settled: "0.00", pending: "0.00", status: "NO_REFUND_REQUIRED" },
    };
  })() : null,
  items: purchase.items?.map((item: any) => ({
    ...item,
    quantity: item.quantity.toString(),
    inventoryBatch: item.inventoryBatch ? {
      ...item.inventoryBatch,
      purchaseRate: item.inventoryBatch.purchaseRate.toString(),
      sellingRate: item.inventoryBatch.sellingRate.toString(),
      mrp: item.inventoryBatch.mrp?.toString() ?? null,
    } : null,
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
