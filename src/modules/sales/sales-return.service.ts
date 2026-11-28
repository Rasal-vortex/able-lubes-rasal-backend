import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { synchronizeProductListingDefault } from "../products/product-default.js";

const dec = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

const saleDetailInclude = {
  customer: { select: { id: true, name: true, storeCreditTransactions: { select: { type: true, amount: true } } } },
  items: {
    include: {
      product: { select: { id: true, name: true } },
      inventoryBatch: true,
      returns: { include: { salesReturn: { select: { id: true, returnedAt: true, reason: true } } } },
    },
  },
  payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
  returns: {
    include: {
      returnedBy: { select: { id: true, name: true } },
      items: { include: { saleItem: { include: { product: { select: { id: true, name: true } } } } } },
      settlements: { include: { createdBy: { select: { id: true, name: true } } } },
    },
    orderBy: { returnedAt: "desc" as const },
  },
  creditBill: { include: { payments: { select: { amount: true } } } },
};

function serializeSale(sale: any) {
  const items = sale.items.map((item: any) => {
    const returnedQuantity = item.returns.reduce((total: Prisma.Decimal, row: any) => total.add(row.quantity), dec(0));
    const returnedDisplayQuantity = item.displayQuantity == null || item.quantity.isZero()
      ? null
      : returnedQuantity.mul(item.displayQuantity).div(item.quantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    return {
      id: item.id,
      productId: item.productId,
      productName: item.product.name,
      inventoryBatchId: item.inventoryBatchId,
      quantity: item.quantity.toString(),
      displayQuantity: item.displayQuantity?.toString() ?? null,
      displayUnitName: item.displayUnitNameSnapshot,
      displayUnitSymbol: item.displayUnitSymbolSnapshot,
      unitName: item.unitNameSnapshot,
      unitSymbol: item.unitSymbolSnapshot,
      unitAllowsDecimals: item.unitAllowsDecimalsSnapshot,
      inventoryBatchReceivedAt: item.inventoryBatch?.receivedAt?.toISOString() ?? null,
      unitSellingPrice: item.unitSellingPrice.toString(),
      discountAmount: item.discountAmount.toString(),
      lineTotal: item.lineTotal.toString(),
      historicalCostSnapshot: item.historicalCostSnapshot?.toString() ?? item.inventoryBatch?.purchaseRate.toString() ?? null,
      costSnapshotSource: item.costSnapshotSource,
      historicalMrpSnapshot: item.historicalMrpSnapshot?.toString() ?? null,
      returnedQuantity: returnedQuantity.toString(),
      returnedAmount: item.returns.reduce((total: Prisma.Decimal, row: any) => total.add(row.amount), dec(0)).toString(),
      returnedDisplayQuantity: returnedDisplayQuantity?.toString() ?? null,
      remainingQuantity: Prisma.Decimal.max(dec(0), item.quantity.sub(returnedQuantity)).toString(),
    };
  });
  return {
    id: sale.id,
    invoiceNumber: sale.invoiceNumber,
    billDate: sale.billDate,
    totalAmount: sale.totalAmount.toString(),
    discountAmount: sale.discountAmount.toString(),
    status: sale.status,
    returnStatus: sale.returnStatus,
    customer: sale.customer ? {
      id: sale.customer.id,
      name: sale.customer.name,
      availableStoreCredit: Prisma.Decimal.max(dec(0), sale.customer.storeCreditTransactions.reduce((balance: Prisma.Decimal, row: any) => balance.add(row.type === "CREDIT" ? row.amount : row.amount.neg()), dec(0))).toString(),
    } : null,
    payments: sale.payments.map((payment: any) => ({ ...payment, amount: payment.amount.toString() })),
    items,
    returns: sale.returns.map((salesReturn: any) => ({
      id: salesReturn.id,
      reason: salesReturn.reason,
      returnedAt: salesReturn.returnedAt,
      returnedBy: salesReturn.returnedBy,
      amount: salesReturn.amount.toString(),
      creditAppliedAmount: salesReturn.creditAppliedAmount.toString(),
      settlementType: salesReturn.settlementType,
      pendingRefundPayable: salesReturn.settlementType === "PENDING"
        ? Prisma.Decimal.max(dec(0), salesReturn.amount.sub(salesReturn.creditAppliedAmount).sub(salesReturn.settlements.filter((row: any) => row.type === "REFUND").reduce((sum: Prisma.Decimal, row: any) => sum.add(row.amount), dec(0)))).toString()
        : "0",
      items: salesReturn.items.map((row: any) => ({
        saleItemId: row.saleItemId,
        productName: row.saleItem.product.name,
        quantity: row.quantity.toString(),
        amount: row.amount.toString(),
        costAmount: row.costAmount.toString(),
      })),
      settlements: salesReturn.settlements.map((row: any) => ({
        id: row.id,
        type: row.type,
        amount: row.amount.toString(),
        method: row.method,
        reference: row.reference,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
      })),
    })),
    creditBill: sale.creditBill ? {
      id: sale.creditBill.id,
      billAmount: sale.creditBill.billAmount.toString(),
      paidAmount: sale.payments.reduce((sum: Prisma.Decimal, row: any) => sum.add(row.amount), dec(0)).toString(),
    } : null,
  };
}

export async function getSaleForReturn(id: string) {
  const sale = await prisma.sale.findUnique({ where: { id }, include: saleDetailInclude });
  if (!sale) throw new ApiError(404, "Sale not found");
  return serializeSale(sale);
}

async function createReturnWithinTransaction(tx: Prisma.TransactionClient, saleId: string, input: any, userId: string) {
  const priorByKey = await tx.salesReturn.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: true, settlements: true } });
  if (priorByKey) return { id: priorByKey.id, amount: priorByKey.amount.toString(), replayed: true };

  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    include: {
      items: { include: { product: { include: { unit: true } }, inventoryBatch: true, returns: true } },
      returns: { include: { items: true, settlements: true } },
      payments: true,
      cancellation: true,
      creditBill: { include: { payments: { select: { amount: true } } } },
    },
  });
  if (!sale) throw new ApiError(404, "Sale not found");
  if (sale.status !== "POSTED" || sale.cancellation) throw new ApiError(409, "Only active posted sales can be returned");
  const reason = input.reason.trim();
  if (!reason) throw new ApiError(400, "A return reason is required");

  const lineRevenueTotal = sale.items.reduce((sum, item) => sum.add(item.lineTotal), dec(0));
  if (lineRevenueTotal.lte(0)) throw new ApiError(409, "The original invoice has no returnable line value");
  let allocatedBefore = dec(0);
  const itemById = new Map(sale.items.map((item) => [item.id, item]));
  const quantitiesByBatch = new Map<string, Prisma.Decimal>();
  const quantitiesByProduct = new Map<string, Prisma.Decimal>();
  const returnRows: Array<{ saleItemId: string; quantity: Prisma.Decimal; amount: Prisma.Decimal; costAmount: Prisma.Decimal }> = [];
  let returnAmount = dec(0);

  for (const [index, item] of sale.items.entries()) {
    const allocatedRevenue = index === sale.items.length - 1
      ? sale.totalAmount.sub(allocatedBefore)
      : money(sale.totalAmount.mul(item.lineTotal).div(lineRevenueTotal));
    allocatedBefore = allocatedBefore.add(allocatedRevenue);
    const matching = input.items.find((row: any) => row.saleItemId === item.id);
    if (!matching) continue;
    const quantity = dec(matching.quantity);
    const priorQuantity = item.returns.reduce((sum, row) => sum.add(row.quantity), dec(0));
    const priorAmount = item.returns.reduce((sum, row) => sum.add(row.amount), dec(0));
    const remainingQuantity = item.quantity.sub(priorQuantity);
    if (!quantity.gt(0) || quantity.gt(remainingQuantity))
      throw new ApiError(409, `Return quantity exceeds the remaining sold quantity for ${item.product.name}`);
    if (!item.inventoryBatchId || !item.inventoryBatch || item.inventoryBatch.productId !== item.productId)
      throw new ApiError(409, `The original inventory batch is unavailable for ${item.product.name}; this return cannot safely restore stock`);
    if (item.inventoryBatch.status === "CANCELLED")
      throw new ApiError(409, `The original inventory batch for ${item.product.name} has been cancelled`);
    const amountRemaining = allocatedRevenue.sub(priorAmount);
    const itemAmount = quantity.eq(remainingQuantity)
      ? amountRemaining
      : money(allocatedRevenue.mul(quantity).div(item.quantity));
    if (itemAmount.lt(0)) throw new ApiError(409, "Previously returned amounts exceed the original invoice allocation");
    const costRate = item.historicalCostSnapshot ?? item.inventoryBatch.purchaseRate;
    const costAmount = money(costRate.mul(quantity));
    returnRows.push({ saleItemId: item.id, quantity, amount: itemAmount, costAmount });
    returnAmount = returnAmount.add(itemAmount);
    quantitiesByBatch.set(item.inventoryBatchId, (quantitiesByBatch.get(item.inventoryBatchId) ?? dec(0)).add(quantity));
    quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? dec(0)).add(quantity));
  }
  if (input.items.some((row: any) => !itemById.has(row.saleItemId))) throw new ApiError(400, "A selected invoice product does not belong to this sale");
  if (returnRows.length !== input.items.length) throw new ApiError(400, "Choose at least one invoice product to return");
  returnAmount = money(returnAmount);
  if (!returnAmount.gt(0)) throw new ApiError(400, "The selected return has no refundable value");

  const oldReturnedQty = sale.items.reduce((sum, item) => sum.add(item.returns.reduce((line, row) => line.add(row.quantity), dec(0))), dec(0));
  const newlyReturnedQty = returnRows.reduce((sum, row) => sum.add(row.quantity), dec(0));
  const allReturned = oldReturnedQty.add(newlyReturnedQty).eq(sale.items.reduce((sum, item) => sum.add(item.quantity), dec(0)));

  const creditBillPaid = sale.creditBill ? sale.payments.reduce((sum, row) => sum.add(row.amount), dec(0)) : dec(0);
  const creditBillOutstanding = sale.creditBill
    ? Prisma.Decimal.max(dec(0), sale.creditBill.billAmount.sub(creditBillPaid))
    : dec(0);
  const creditAppliedAmount = Prisma.Decimal.min(returnAmount, creditBillOutstanding);
  const settlementAmount = returnAmount.sub(creditAppliedAmount);
  if (input.settlementType === "CUSTOMER_CREDIT" && settlementAmount.gt(0) && !sale.customerId)
    throw new ApiError(400, "A registered customer is required for customer credit");

  const refunds = input.refunds ?? [];
  const refundTotal = refunds.reduce((sum: Prisma.Decimal, row: any) => sum.add(dec(row.amount)), dec(0));
  if (input.settlementType === "REFUND" && settlementAmount.gt(0) && !refundTotal.eq(settlementAmount))
    throw new ApiError(400, "Refund Now amounts must equal the return amount after any customer balance adjustment");
  if (input.settlementType === "REFUND" && settlementAmount.isZero() && refundTotal.gt(0))
    throw new ApiError(400, "This return only reduces the customer's outstanding invoice balance; no cash refund is due");
  if (input.settlementType !== "REFUND" && refunds.length)
    throw new ApiError(400, "Choose Refund Now to record actual refund payments");
  const alreadyRefunded = sale.returns.flatMap((row) => row.settlements).filter((row) => row.type === "REFUND").reduce((sum, row) => sum.add(row.amount), dec(0));
  const actualCollected = sale.payments.filter((payment) => payment.method === "CASH" || payment.method === "UPI").reduce((sum, payment) => sum.add(payment.amount), dec(0));
  const pendingRefundPayable = sale.returns.flatMap((row) => row.settlements).filter((row) => row.type === "PENDING").reduce((sum, row) => sum.add(row.amount), dec(0));
  if (input.settlementType === "REFUND" && refundTotal.add(alreadyRefunded).gt(actualCollected))
    throw new ApiError(400, "Refunds cannot exceed the original Cash and UPI payments received, less prior refunds");

  const salesReturn = await tx.salesReturn.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      saleId: sale.id,
      reason,
      returnedById: userId,
      settlementType: settlementAmount.isZero() ? "BALANCE_OFFSET" : input.settlementType,
      amount: returnAmount,
      creditAppliedAmount,
      items: { create: returnRows },
      settlements: settlementAmount.gt(0)
        ? input.settlementType === "REFUND"
          ? { create: refunds.map((refund: any) => ({ type: "REFUND", amount: dec(refund.amount), method: refund.method, reference: refund.reference?.trim() || null, createdById: userId })) }
          : input.settlementType === "CUSTOMER_CREDIT"
            ? { create: [{ type: "CUSTOMER_CREDIT", amount: settlementAmount, createdById: userId }] }
            : { create: [{ type: "PENDING", amount: settlementAmount, createdById: userId }] }
        : undefined,
    },
  });

  if (creditAppliedAmount.gt(0) && sale.creditBill) {
    await tx.customerCreditBill.update({ where: { id: sale.creditBill.id }, data: { billAmount: { decrement: creditAppliedAmount } } });
  }
  if (input.settlementType === "CUSTOMER_CREDIT" && settlementAmount.gt(0)) {
    await tx.customerStoreCreditTransaction.create({ data: { customerId: sale.customerId!, type: "CREDIT", amount: settlementAmount, salesReturnId: salesReturn.id } });
  }

  for (const [batchId, quantity] of quantitiesByBatch) {
    const item = sale.items.find((row) => row.inventoryBatchId === batchId)!;
    const batch = item.inventoryBatch!;
    if (batch.remainingQuantity.add(quantity).gt(batch.receivedQuantity))
      throw new ApiError(409, "Returned quantity cannot be restored to its original inventory batch");
    const updated = await tx.inventoryBatch.updateMany({
      where: { id: batchId, status: batch.status, remainingQuantity: batch.remainingQuantity },
      data: { remainingQuantity: { increment: quantity }, status: "ACTIVE" },
    });
    if (updated.count !== 1) throw new ApiError(409, "Original inventory batch changed while processing the return; retry the request");
  }
  for (const [productId, quantity] of quantitiesByProduct) {
    const product = await tx.product.update({ where: { id: productId }, data: { currentStock: { increment: quantity } }, select: { currentStock: true } });
    const productBatchIds = [...quantitiesByBatch.entries()].filter(([batchId]) => sale.items.some((item) => item.inventoryBatchId === batchId && item.productId === productId));
    for (const [batchId, restoredQuantity] of productBatchIds) {
      await tx.stockMovement.create({ data: {
        productId, inventoryBatchId: batchId, type: "SALE_RETURN", direction: "IN", quantity: restoredQuantity,
        stockAfter: product.currentStock, reason: `Sales return ${sale.invoiceNumber}`, notes: reason, createdById: userId,
      } });
    }
    await synchronizeProductListingDefault(tx, productId);
  }

  const allPending = pendingRefundPayable.add(input.settlementType === "PENDING" ? settlementAmount : dec(0));
  await tx.sale.update({
    where: { id: sale.id },
    data: { returnStatus: allReturned ? "FULLY_RETURNED" : "PARTIALLY_RETURNED" },
  });
  return { id: salesReturn.id, amount: returnAmount.toString(), creditAppliedAmount: creditAppliedAmount.toString(), pendingRefundPayable: allPending.toString(), settlementAmount: settlementAmount.toString(), replayed: false };
}

export async function createSalesReturn(saleId: string, input: any, userId: string) {
  try {
    return await prisma.$transaction((tx) => createReturnWithinTransaction(tx, saleId, input, userId), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15_000,
    });
  } catch (error) {
    const replay = await prisma.salesReturn.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: true } }).catch(() => null);
    if (replay) return { id: replay.id, amount: replay.amount.toString(), replayed: true };
    throw error;
  }
}

export async function settlePendingSalesReturn(returnId: string, input: any, userId: string) {
  return prisma.$transaction(async (tx) => {
    const replay = await tx.salesReturnSettlement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (replay) return { id: replay.id, amount: replay.amount.toString(), replayed: true };
    const salesReturn = await tx.salesReturn.findUnique({ where: { id: returnId }, include: { sale: { include: { payments: true } }, settlements: true } });
    if (!salesReturn) throw new ApiError(404, "Sales return not found");
    if (salesReturn.settlementType !== "PENDING") throw new ApiError(409, "This return has no pending refund payable");
    const alreadySettled = salesReturn.settlements.filter((row) => row.type === "REFUND").reduce((sum, row) => sum.add(row.amount), dec(0));
    const pending = salesReturn.amount.sub(salesReturn.creditAppliedAmount).sub(alreadySettled);
    const refunds = input.refunds as Array<{ amount: string | number; method: "CASH" | "UPI" | "BANK" | "OTHER"; reference?: string }>;
    const refundTotal = refunds.reduce((sum, row) => sum.add(dec(row.amount)), dec(0));
    if (refundTotal.gt(pending)) throw new ApiError(400, "Settlement exceeds the outstanding refund payable");
    const originalCollected = salesReturn.sale.payments.filter((row) => row.method === "CASH" || row.method === "UPI").reduce((sum, row) => sum.add(row.amount), dec(0));
    const allReturnRefunds = await tx.salesReturnSettlement.aggregate({ where: { salesReturn: { saleId: salesReturn.saleId }, type: "REFUND" }, _sum: { amount: true } });
    if (refundTotal.add(allReturnRefunds._sum.amount ?? dec(0)).gt(originalCollected))
      throw new ApiError(400, "Refunds cannot exceed the original Cash and UPI payments received, less prior refunds");
    const created = await Promise.all(refunds.map((refund) => tx.salesReturnSettlement.create({
      data: { idempotencyKey: refund === refunds[0] ? input.idempotencyKey : undefined, salesReturnId: salesReturn.id, type: "REFUND", amount: dec(refund.amount), method: refund.method, reference: refund.reference?.trim() || null, createdById: userId },
    })));
    return { id: created[0]?.id, amount: refundTotal.toString(), pendingRefundPayable: pending.sub(refundTotal).toString(), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
