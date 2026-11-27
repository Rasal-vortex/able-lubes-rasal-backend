import { reportModel } from "./report.model.js";
import { purchaseCancellationBlockers } from "../purchases/purchase-eligibility.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { ApiError } from "../../shared/errors.js";
const decimal = (value: any) => new Prisma.Decimal(value ?? 0);
const sum = (values: any[]) =>
  values.reduce((acc, v) => acc.add(decimal(v)), decimal(0)).toFixed(2);
const bucketDate = (date: Date, monthly = false) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const fields = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return monthly
    ? `${fields.year}-${fields.month}`
    : `${fields.year}-${fields.month}-${fields.day}`;
};
export async function salesReport(from: Date, to: Date) {
  const [rows, returns] = await Promise.all([reportModel.sales(from, to), reportModel.salesReturns(from, to)]);
  const groups = new Map<string, any>();
  for (const row of rows) {
    const key = bucketDate(row.billDate);
    const group = groups.get(key) ?? {
      date: key,
      invoices: 0,
      subtotal: decimal(0),
      discounts: decimal(0),
      sales: decimal(0),
    };
    group.invoices++;
    group.subtotal = group.subtotal.add(row.subtotal);
    group.discounts = group.discounts.add(row.discountAmount);
    group.sales = group.sales.add(row.totalAmount);
    groups.set(key, group);
  }
  for (const salesReturn of returns) {
    const key = bucketDate(salesReturn.returnedAt);
    const group = groups.get(key) ?? { date: key, invoices: 0, subtotal: decimal(0), discounts: decimal(0), sales: decimal(0) };
    group.sales = group.sales.sub(salesReturn.amount);
    groups.set(key, group);
  }
  const grossSales = decimal(sum(rows.map((row) => row.totalAmount)));
  const returnAmount = decimal(sum(returns.map((row) => row.amount)));
  return {
    totals: {
      invoices: rows.length,
      sales: grossSales.sub(returnAmount).toFixed(2),
      returned: returnAmount.toFixed(2),
      discounts: sum(rows.map((r) => r.discountAmount)),
    },
    days: [...groups.values()].map((x) => ({
      ...x,
      subtotal: x.subtotal.toFixed(2),
      discounts: x.discounts.toFixed(2),
      sales: x.sales.toFixed(2),
    })),
    invoices: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      status: row.returnStatus === "FULLY_RETURNED" ? "Fully Returned" : row.returnStatus === "PARTIALLY_RETURNED" ? "Partially Returned" : "Posted",
      date: row.billDate,
      customer: row.customer?.name ?? "Walk-in customer",
      total: Prisma.Decimal.max(decimal(0), row.totalAmount.sub(row.returns.reduce((sum, salesReturn) => sum.add(salesReturn.amount), decimal(0)))).toFixed(2),
      items: row.items.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: (() => {
          const returned = item.returns.reduce((sum, salesReturn) => sum.add(salesReturn.quantity), decimal(0));
          const netQuantity = Prisma.Decimal.max(decimal(0), item.quantity.sub(returned));
          return item.displayQuantity != null && !item.quantity.isZero() ? item.displayQuantity.mul(netQuantity).div(item.quantity).toString() : netQuantity.toString();
        })(),
        returnedQuantity: (() => {
          const returned = item.returns.reduce((sum, salesReturn) => sum.add(salesReturn.quantity), decimal(0));
          return item.displayQuantity != null && !item.quantity.isZero() ? item.displayQuantity.mul(returned).div(item.quantity).toString() : returned.toString();
        })(),
        unitName: item.displayUnitNameSnapshot ?? item.unitNameSnapshot,
        unitSymbol: item.displayUnitSymbolSnapshot ?? item.unitSymbolSnapshot,
        unitSellingPrice: item.unitSellingPrice.toFixed(2),
        discountAmount: item.discountAmount.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
      payments: row.payments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toFixed(2),
        method: payment.method,
        date: payment.paymentDate,
      })),
    })),
    returns: returns.map((row) => ({ id: row.id, invoiceNumber: row.sale.invoiceNumber, customer: row.sale.customer?.name ?? "Walk-in customer", date: row.returnedAt, amount: row.amount.toFixed(2), reason: row.reason })),
  };
}

function localDayStart(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: env.BUSINESS_TIME_ZONE,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(instant));
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day));
    instant = target - (represented - instant);
  }
  return new Date(instant);
}

export async function dailySales(date: string) {
  const from = localDayStart(date);
  const [year, month, day] = date.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
  const to = localDayStart(`${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}`);
  const [payments, refunds, cancellations, billedSales, salesReturns, returnRefunds] = await Promise.all([
    reportModel.dailyPayments(from, to),
    reportModel.dailyRefunds(from, to),
    reportModel.dailyPaymentCorrections(from, to),
    reportModel.dailyInvoices(from, to),
    reportModel.dailySalesReturns(from, to),
    reportModel.dailyReturnRefunds(from, to),
  ]);
  const bySale = new Map<string, any>();
  const byMethod = new Map<string, Prisma.Decimal>();
  let collected = decimal(0);
  for (const payment of payments) {
    const sale = payment.sale;
    if (!sale) continue;
    const bill = bySale.get(sale.id) ?? {
      id: sale.id,
      saleId: sale.id,
      invoiceNumber: sale.invoiceNumber,
      billDate: sale.billDate,
      discountAmount: sale.discountAmount.toFixed(2),
      totalAmount: sale.totalAmount.toFixed(2),
      returnStatus: sale.returnStatus,
      customer: sale.customer?.name ?? "Walk-in customer",
      products: sale.items.map((item) => ({
        saleItemId: item.id,
        productId: item.product.id, productName: item.product.name,
        quantity: (item.displayQuantity ?? item.quantity).toString(), unitName: item.displayUnitNameSnapshot ?? item.unitNameSnapshot,
        unitSymbol: item.displayUnitSymbolSnapshot ?? item.unitSymbolSnapshot,
        unitSellingPrice: item.unitSellingPrice.toFixed(2),
        discountAmount: item.discountAmount.toFixed(2), lineTotal: item.lineTotal.toFixed(2),
        returnedQuantity: item.returns.reduce((sum, row) => sum.add(row.quantity), decimal(0)).toString(),
      })),
      payments: [],
      paymentsOnDate: [],
    };
    const dailyPayment = { id: payment.id, method: payment.method, amount: payment.amount.toFixed(2), date: payment.paymentDate, notes: payment.notes };
    bill.payments.push(dailyPayment);
    bill.paymentsOnDate.push(dailyPayment);
    bySale.set(sale.id, bill);
    if (payment.method === "CASH" || payment.method === "UPI") {
      collected = collected.add(payment.amount);
      byMethod.set(payment.method, (byMethod.get(payment.method) ?? decimal(0)).add(payment.amount));
    }
  }
  for (const sale of billedSales) {
    const lineRevenueTotal = sale.items.reduce((sum, item) => sum.add(item.lineTotal), decimal(0));
    const paymentDerivedSale = bySale.get(sale.id);
    const paymentsById = new Map<string, any>();
    for (const payment of [...(paymentDerivedSale?.payments ?? []), ...sale.payments.map((payment) => ({ id: payment.id, method: payment.method, amount: payment.amount.toFixed(2), date: payment.paymentDate, notes: payment.notes }))])
      paymentsById.set(payment.id, payment);
    const paymentsOnDateById = new Map<string, any>();
    for (const payment of paymentDerivedSale?.paymentsOnDate ?? []) paymentsOnDateById.set(payment.id, payment);
    for (const payment of sale.payments) {
      if (bucketDate(payment.paymentDate) === date)
        paymentsOnDateById.set(payment.id, { id: payment.id, method: payment.method, amount: payment.amount.toFixed(2), date: payment.paymentDate, notes: payment.notes });
    }
    bySale.set(sale.id, {
      ...paymentDerivedSale,
      id: sale.id,
      saleId: sale.id,
      invoiceNumber: sale.invoiceNumber,
      billDate: sale.billDate,
      discountAmount: sale.discountAmount.toFixed(2),
      totalAmount: sale.totalAmount.toFixed(2),
      netSalesAmount: Prisma.Decimal.max(decimal(0), sale.totalAmount.sub(sale.returns.reduce((sum, salesReturn) => sum.add(salesReturn.amount), decimal(0)))).toFixed(2),
      returnStatus: sale.returnStatus,
      returns: sale.returns.map((salesReturn) => ({ amount: salesReturn.amount.toFixed(2), returnedAt: salesReturn.returnedAt })),
      customer: sale.customer?.name ?? "Walk-in customer",
      products: sale.items.map((item) => ({
        saleItemId: item.id,
        productId: item.productId,
        productName: item.product.name,
        quantity: item.quantity.toString(),
        displayQuantity: item.displayQuantity?.toString() ?? null,
        displayUnitName: item.displayUnitNameSnapshot,
        displayUnitSymbol: item.displayUnitSymbolSnapshot,
        unitName: item.unitNameSnapshot,
        unitSymbol: item.unitSymbolSnapshot,
        unitSellingPrice: item.unitSellingPrice.toFixed(2),
        discountAmount: item.discountAmount.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
        returnedQuantity: item.returns.reduce((sum, row) => sum.add(row.quantity), decimal(0)).toString(),
        returnedAmount: item.returns.reduce((sum, row) => sum.add(row.amount), decimal(0)).toFixed(2),
      })),
      payments: [...paymentsById.values()],
      paymentsOnDate: [...paymentsOnDateById.values()],
      lineRevenueTotal: lineRevenueTotal.toFixed(2),
    });
  }
  const paymentCorrections: Array<Record<string, unknown>> = [];
  const creditCancellations: Array<Record<string, unknown>> = [];
  for (const cancellation of cancellations) {
    if (!cancellation.sale) continue;
    const reversalsByPayment = new Map<string, Prisma.Decimal>();
    const verifiedByMethod = new Map<string, Prisma.Decimal>();
    for (const correction of cancellation.paymentCorrections) {
      paymentCorrections.push({
        id: correction.id,
        invoiceNumber: cancellation.sale.invoiceNumber,
        customer: cancellation.sale.customer?.name ?? "Walk-in customer",
        type: correction.type,
        method: correction.method,
        amount: correction.amount.toFixed(2),
        reason: correction.reason,
        date: correction.createdAt,
      });
      if (correction.type === "REVERSAL" && correction.originalPaymentId) {
        reversalsByPayment.set(
          correction.originalPaymentId,
          (reversalsByPayment.get(correction.originalPaymentId) ?? decimal(0)).add(correction.amount),
        );
      } else if (correction.type === "ACTUAL_RECEIPT") {
        verifiedByMethod.set(correction.method, (verifiedByMethod.get(correction.method) ?? decimal(0)).add(correction.amount));
      }
    }
    for (const payment of cancellation.sale.payments) {
      if (payment.method === "COUPON") continue;
      const verifiedAmount = Prisma.Decimal.max(
        decimal(0),
        payment.amount.sub(reversalsByPayment.get(payment.id) ?? decimal(0)),
      );
      if (verifiedAmount.gt(0))
        verifiedByMethod.set(payment.method, (verifiedByMethod.get(payment.method) ?? decimal(0)).add(verifiedAmount));
    }
    for (const [method, amount] of verifiedByMethod) {
      collected = collected.add(amount);
      byMethod.set(method, (byMethod.get(method) ?? decimal(0)).add(amount));
    }
    creditCancellations.push({
      id: cancellation.id,
      invoiceNumber: cancellation.sale.invoiceNumber,
      customer: cancellation.sale.customer?.name ?? "Walk-in customer",
      reason: cancellation.reason,
      date: cancellation.cancelledAt,
      amount: cancellation.sale.totalAmount.toFixed(2),
      actualReceivedAmount: cancellation.actualReceivedAmount.toFixed(2),
      pendingRefundAmount: cancellation.pendingAmount.toFixed(2),
      cancelledBy: cancellation.cancelledBy?.name ?? null,
      recordedPayments: cancellation.sale.payments.map((payment) => ({
        id: payment.id, method: payment.method, amount: payment.amount.toFixed(2),
      })),
      actualPayments: [...verifiedByMethod.entries()].map(([method, amount]) => ({
        method, amount: amount.toFixed(2),
      })),
      paymentCorrections: cancellation.paymentCorrections.map((correction) => ({
        id: correction.id, type: correction.type, amount: correction.amount.toFixed(2),
        method: correction.method, reason: correction.reason, date: correction.createdAt,
        originalPaymentId: correction.originalPaymentId,
      })),
      refunds: cancellation.refunds.map((refund) => ({
        id: refund.id, amount: refund.amount.toFixed(2), method: refund.method,
        reference: refund.reference, date: refund.createdAt,
      })),
    });
  }
  return {
    date,
    totals: {
      collected: collected.toFixed(2),
      refunded: sum([...refunds.map((refund) => refund.amount), ...returnRefunds.map((refund) => refund.amount)]),
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount: amount.toFixed(2) })),
    },
    invoices: [...bySale.values()].map((sale) => {
      const paymentsReceived = sale.paymentsOnDate.filter((payment: any) => payment.method === "CASH" || payment.method === "UPI").reduce((total: Prisma.Decimal, payment: any) => total.add(payment.amount), decimal(0));
      const allocatedPayments = sale.paymentsOnDate.reduce((total: Prisma.Decimal, payment: any) => total.add(payment.amount), decimal(0));
      const creditAmount = bucketDate(sale.billDate) === date ? Prisma.Decimal.max(decimal(0), decimal(sale.totalAmount).sub(allocatedPayments)) : decimal(0);
      return { ...sale, isSaleDate: bucketDate(sale.billDate) === date, paymentsReceived: paymentsReceived.toFixed(2), creditAmount: creditAmount.toFixed(2) };
    }),
    paymentCorrections,
    creditCancellations,
    refunds: [
      ...refunds.map((refund) => ({
      id: refund.id,
      invoiceNumber: refund.cancellation.sale.invoiceNumber,
      customer: refund.cancellation.sale.customer?.name ?? "Walk-in customer",
      amount: refund.amount.toFixed(2),
      method: refund.method,
      reference: refund.reference,
      originalPaymentId: refund.originalPaymentId,
      date: refund.createdAt,
      })),
      ...returnRefunds.map((refund) => ({
        id: refund.id,
        invoiceNumber: refund.salesReturn.sale.invoiceNumber,
        customer: refund.salesReturn.sale.customer?.name ?? "Walk-in customer",
        amount: refund.amount.toFixed(2), method: refund.method, reference: refund.reference,
        date: refund.createdAt,
      })),
    ],
    salesReturns: salesReturns.map((salesReturn) => ({
      id: salesReturn.id,
      invoiceNumber: salesReturn.sale.invoiceNumber,
      customer: salesReturn.sale.customer?.name ?? "Walk-in customer",
      reason: salesReturn.reason,
      date: salesReturn.returnedAt,
      amount: salesReturn.amount.toFixed(2),
      creditAppliedAmount: salesReturn.creditAppliedAmount.toFixed(2),
      settlementType: salesReturn.settlementType,
      returnedBy: salesReturn.returnedBy?.name ?? null,
      settlements: salesReturn.settlements.map((row) => ({ id: row.id, type: row.type, amount: row.amount.toFixed(2), method: row.method, reference: row.reference, date: row.createdAt })),
    })),
  };
}

export async function profitReport(from: Date, to: Date) {
  const [rows, returns] = await Promise.all([reportModel.sales(from, to, true), reportModel.salesReturns(from, to)]);
  const expenses = await reportModel.expenses(from, to);
  const dailyBuckets = new Map<string, { grossProfit: Prisma.Decimal; expenses: Prisma.Decimal }>();
  let recognizedRevenue = decimal(0);
  const getBucket = (date: Date) => {
    const key = bucketDate(date);
    const bucket = dailyBuckets.get(key) ?? { grossProfit: decimal(0), expenses: decimal(0) };
    dailyBuckets.set(key, bucket);
    return bucket;
  };
  const recognitionDate = (sale: { settledAt: Date | null; billDate: Date; creditBill: { id: string } | null }) =>
    sale.settledAt ?? (sale.creditBill ? null : sale.billDate);
  const invoices = rows.flatMap((sale) => {
    const settledAt = recognitionDate(sale);
    if (!settledAt || settledAt < from || settledAt > to) return [];
    const lineRevenueTotal = sale.items.reduce((value, item) => value.add(item.lineTotal), decimal(0));
    let allocatedSaleAmount = decimal(0);
    const items = sale.items.map((item, index) => {
      const costRate = item.historicalCostSnapshot ?? item.inventoryBatch?.purchaseRate ?? item.product.purchaseRate;
      const costBasis = item.costSnapshotSource ??
        (item.inventoryBatch ? "VERIFIED_BATCH" : "LEGACY_ESTIMATE");
      const cost = costRate.mul(item.quantity).toDecimalPlaces(2);
      // Allocate invoice-level discounts proportionally so item profit sums to
      // the actual billed total, while line discounts are already in lineTotal.
      const allocatedAmount = lineRevenueTotal.gt(0)
        ? sale.totalAmount.mul(item.lineTotal).div(lineRevenueTotal)
        : item.lineTotal;
      // Keep proportional discount allocation in cents and put any rounding remainder on the last line.
      const saleAmount = lineRevenueTotal.gt(0) && index === sale.items.length - 1
        ? sale.totalAmount.sub(allocatedSaleAmount)
        : allocatedAmount.toDecimalPlaces(2);
      allocatedSaleAmount = allocatedSaleAmount.add(saleAmount);
      const priorReturns = (item.returns ?? []).filter((salesReturn) => salesReturn.salesReturn.returnedAt <= settledAt);
      const returnedAmount = priorReturns.reduce((total, salesReturn) => total.add(salesReturn.amount), decimal(0));
      const returnedCost = priorReturns.reduce((total, salesReturn) => total.add(salesReturn.costAmount), decimal(0));
      const returnedQuantity = priorReturns.reduce((total, salesReturn) => total.add(salesReturn.quantity), decimal(0));
      const recognizedSaleAmount = Prisma.Decimal.max(decimal(0), saleAmount.sub(returnedAmount));
      const recognizedCost = Prisma.Decimal.max(decimal(0), cost.sub(returnedCost));
      const profit = recognizedSaleAmount.sub(recognizedCost);
      recognizedRevenue = recognizedRevenue.add(recognizedSaleAmount);
      getBucket(settledAt).grossProfit = getBucket(settledAt).grossProfit.add(profit);
      return {
        productId: item.product.id,
        productName: item.product.name,
        quantity: Prisma.Decimal.max(decimal(0), item.quantity.sub(returnedQuantity)).toString(),
        saleAmount: recognizedSaleAmount.toFixed(2),
        purchaseRate: costRate.toFixed(2),
        costBasis,
        cost: recognizedCost.toFixed(2),
        profit: profit.toFixed(2),
      };
    });
    return items.some((item) => Number(item.saleAmount) > 0)
      ? [{ invoiceNumber: sale.invoiceNumber, date: settledAt, items }]
      : [];
  });
  const returnEvents = returns.flatMap((salesReturn) => {
    const saleRecognizedAt = recognitionDate(salesReturn.sale);
    if (!saleRecognizedAt || salesReturn.returnedAt <= saleRecognizedAt) return [];
    const items = salesReturn.items.map((item) => {
      const saleItem = item.saleItem;
      const costRate = saleItem.historicalCostSnapshot ?? saleItem.inventoryBatch?.purchaseRate ?? saleItem.product.purchaseRate;
      const costBasis = saleItem.costSnapshotSource ??
        (saleItem.inventoryBatch ? "VERIFIED_BATCH" : "LEGACY_ESTIMATE");
      const profitReversal = item.amount.sub(item.costAmount);
      getBucket(salesReturn.returnedAt).grossProfit = getBucket(salesReturn.returnedAt).grossProfit.sub(profitReversal);
      return {
        productId: saleItem.product.id,
        productName: `Return · ${saleItem.product.name}`,
        quantity: item.quantity.negated().toString(),
        saleAmount: item.amount.negated().toFixed(2),
        purchaseRate: item.quantity.isZero() ? costRate.toFixed(2) : item.costAmount.div(item.quantity).toFixed(2),
        costBasis,
        cost: item.costAmount.negated().toFixed(2),
        profit: profitReversal.negated().toFixed(2),
      };
    });
    recognizedRevenue = recognizedRevenue.sub(salesReturn.amount);
    return [{ invoiceNumber: salesReturn.sale.invoiceNumber, date: salesReturn.returnedAt, items }];
  });
  for (const expense of expenses) {
    getBucket(expense.expenseDate).expenses = getBucket(expense.expenseDate).expenses.add(expense.amount);
  }
  const daily = [...dailyBuckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, bucket]) => {
    const grossProfit = bucket.grossProfit.toDecimalPlaces(2);
    const dayExpenses = bucket.expenses.toDecimalPlaces(2);
    return { date, grossProfit: grossProfit.toFixed(2), expenses: dayExpenses.toFixed(2), netProfit: grossProfit.sub(dayExpenses).toFixed(2) };
  });
  // Use the same rounded daily values as the Daily Summary so its rows reconcile exactly to the card.
  const totalProfit = daily.reduce((total, row) => total.add(row.grossProfit), decimal(0));
  const totalExpenses = daily.reduce((total, row) => total.add(row.expenses), decimal(0));
  const finalProfit = daily.reduce((total, row) => total.add(row.netProfit), decimal(0));
  return {
    totals: {
      netSales: recognizedRevenue.toFixed(2),
      totalProfit: totalProfit.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      finalProfit: finalProfit.toFixed(2),
    },
    invoices,
    returns: returnEvents,
    daily,
  };
}

export async function supplierLedger(id: string) {
  const supplier = await reportModel.supplier(id);
  if (!supplier) throw new ApiError(404, "Supplier not found");
  const supplierCredits = await reportModel.supplierCredits(id);
  let billed = decimal(0);
  let paid = decimal(0);
  let creditAppliedTotal = decimal(0);
  const purchases = supplier.purchases.map((purchase) => {
    const purchasePaid = purchase.payments.reduce((value, payment) => {
      const reversed = payment.reversals.reduce((total, row) => total.add(row.amount), decimal(0));
      return value.add(Prisma.Decimal.max(decimal(0), payment.amount.sub(reversed)));
    }, decimal(0));
    const creditApplied = purchase.supplierCreditApplications.reduce((value, application) => application.reversals.length ? value : value.add(application.amount), decimal(0));
    if (purchase.status === "POSTED") {
      billed = billed.add(purchase.totalAmount);
      paid = paid.add(purchasePaid);
      creditAppliedTotal = creditAppliedTotal.add(creditApplied);
    }
    const refund = purchase.cancellation?.supplierRefund;
    const refundLines = refund?.settlements.flatMap((settlement) => settlement.lines) ?? [];
    const refundSettled = refundLines
      .reduce((total, line) => total.add(line.amount), decimal(0)) ?? decimal(0);
    const settledByPayment = new Map<string, Prisma.Decimal>();
    for (const line of refundLines) {
      settledByPayment.set(line.originalPaymentId, (settledByPayment.get(line.originalPaymentId) ?? decimal(0)).add(line.amount));
    }
    const refundPending = refund ? Prisma.Decimal.max(decimal(0), refund.amount.sub(refundSettled)) : decimal(0);
    const refundStatus = !refund || refund.amount.isZero()
      ? "NO_REFUND_REQUIRED"
      : refundPending.isZero() ? "FULLY_REFUNDED"
        : refundSettled.isZero() ? "REFUND_PENDING" : "PARTIALLY_REFUNDED";
    const blockers = purchaseCancellationBlockers(purchase);
    return {
      id: purchase.id,
      purchaseNumber: purchase.purchaseNumber,
      supplierInvoiceNumber: purchase.supplierInvoiceNumber,
      date: purchase.purchaseDate,
      status: purchase.status,
      total: purchase.totalAmount.toFixed(2),
      paid: purchasePaid.toFixed(2),
      creditApplied: creditApplied.toFixed(2),
      outstanding: purchase.status === "POSTED" ? Prisma.Decimal.max(decimal(0), purchase.totalAmount.sub(purchasePaid).sub(creditApplied)).toFixed(2) : "0.00",
      cancellationEligibility: { eligible: purchase.status === "POSTED" && blockers.length === 0, reasons: blockers.map((blocker) => blocker.reason), blockers },
      cancellation: purchase.cancellation ? {
        reason: purchase.cancellation.reason,
        cancelledAt: purchase.cancellation.cancelledAt,
        cancelledBy: purchase.cancellation.cancelledBy,
        refund: refund ? {
          id: refund.id,
          amount: refund.amount.toFixed(2),
          settled: refundSettled.toFixed(2),
          pending: refundPending.toFixed(2),
          status: refundStatus,
          settlements: refund.settlements.map((settlement) => ({
            id: settlement.id,
            date: settlement.settledAt,
            lines: settlement.lines.map((line) => ({ originalPaymentId: line.originalPaymentId, amount: line.amount.toFixed(2), method: line.method, reference: line.reference })),
          })),
          allocations: purchase.payments.map((payment) => {
            const allocationSettled = settledByPayment.get(payment.id) ?? decimal(0);
            return {
              originalPaymentId: payment.id,
              paidAmount: payment.amount.toFixed(2),
              settled: allocationSettled.toFixed(2),
              pending: Prisma.Decimal.max(decimal(0), payment.amount.sub(allocationSettled)).toFixed(2),
              method: payment.method,
              receiptNumber: payment.receiptNumber,
            };
          }),
        } : { amount: "0.00", settled: "0.00", pending: "0.00", status: refundStatus, settlements: [] },
      } : null,
      items: purchase.items.map((item) => ({
        id: item.id,
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity.toString(),
        unitName: item.unitNameSnapshot,
        unitSymbol: item.unitSymbolSnapshot,
        purchaseRate: item.supplierRate.toFixed(2),
        lineTotal: item.lineTotal.toFixed(2),
      })),
      payments: purchase.payments.map((payment) => ({
        id: payment.id, paymentGroupId: payment.paymentGroupId, amount: payment.amount.toFixed(2), reversedAmount: payment.reversals.reduce((total, reversal) => total.add(reversal.amount), decimal(0)).toFixed(2), reversalHistory: payment.reversals.map((reversal) => ({ amount: reversal.amount.toFixed(2), reason: reversal.reason, date: reversal.createdAt })), transferDecisions: payment.transferDecisions.map((decision) => ({ wasTransferred: decision.wasTransferred, cancellationPurchaseId: decision.cancellation.purchaseId, decidedAt: decision.cancellation.cancelledAt })), method: payment.method, date: payment.paymentDate, receiptNumber: payment.receiptNumber,
      })),
    };
  });
  const supplierRefunds = await reportModel.supplierRefunds(id);
  const refundReceivable = supplierRefunds
    .filter((refund) => refund.cancellation.purchase.supplierId === id)
    .reduce((sum, refund) => {
      const settled = refund.settlements.flatMap((settlement) => settlement.lines).reduce((total, line) => total.add(line.amount), decimal(0));
      return sum.add(Prisma.Decimal.max(decimal(0), refund.amount.sub(settled)));
    }, decimal(0));
  const supplierCreditBalance = supplierCredits.reduce((total, credit) => {
    const applied = credit.applications.reduce((applicationTotal, application) => application.reversals.length ? applicationTotal : applicationTotal.add(application.amount), decimal(0));
    const reversed = credit.reversals.reduce((reversalTotal, reversal) => reversalTotal.add(reversal.amount), decimal(0));
    return total.add(Prisma.Decimal.max(decimal(0), credit.amount.sub(applied).sub(reversed)));
  }, decimal(0));
  return {
    supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
    totals: { billed: billed.toFixed(2), paid: paid.toFixed(2), creditApplied: creditAppliedTotal.toFixed(2), outstanding: Prisma.Decimal.max(decimal(0), billed.sub(paid).sub(creditAppliedTotal)).toFixed(2), supplierCredit: supplierCreditBalance.toFixed(2), refundReceivable: refundReceivable.toFixed(2) },
    purchases,
  };
}
export async function purchaseReport(from: Date, to: Date) {
  const [rows, cancellations] = await Promise.all([reportModel.purchases(from, to), reportModel.purchaseCancellations(from, to)]);
  const grossPurchases = sum(rows.map((row) => row.totalAmount));
  const cancelledAmount = sum(cancellations.map((row) => row.purchase.totalAmount));
  const events = [
    ...rows.map((row) => ({
      eventType: "PURCHASE" as const,
      date: row.purchaseDate,
      purchaseDate: row.purchaseDate,
      cancellationDate: row.cancellation?.cancelledAt ?? null,
      purchaseId: row.id,
      purchaseNumber: row.supplierInvoiceNumber || row.purchaseNumber,
      supplierName: row.supplier.name,
      originalAmount: row.totalAmount.toFixed(2),
      cancellationAmount: "0.00",
      netAmount: row.totalAmount.toFixed(2),
      status: row.status,
    })),
    ...cancellations.map((row) => ({
      eventType: "CANCELLATION" as const,
      date: row.cancelledAt,
      purchaseDate: row.purchase.purchaseDate,
      cancellationDate: row.cancelledAt,
      purchaseId: row.purchase.id,
      purchaseNumber: row.purchase.supplierInvoiceNumber || row.purchase.purchaseNumber,
      supplierName: row.purchase.supplier.name,
      originalAmount: null,
      cancellationAmount: row.purchase.totalAmount.neg().toFixed(2),
      netAmount: row.purchase.totalAmount.neg().toFixed(2),
      status: "CANCELLED" as const,
    })),
  ].sort((left, right) => left.date.getTime() - right.date.getTime() || left.purchaseNumber.localeCompare(right.purchaseNumber));
  return {
    count: rows.length,
    postedCount: rows.filter((row) => row.status === "POSTED").length,
    cancelledPurchaseCount: rows.filter((row) => row.status === "CANCELLED").length,
    total: grossPurchases,
    grossTotal: grossPurchases,
    cancellationCount: cancellations.length,
    cancellationTotal: cancelledAmount,
    netTotal: decimal(grossPurchases).sub(cancelledAmount).toFixed(2),
    cancellations: cancellations.map((row) => ({ id: row.id, date: row.cancelledAt, purchaseId: row.purchase.id, purchaseNumber: row.purchase.supplierInvoiceNumber || row.purchase.purchaseNumber, supplierName: row.purchase.supplier.name, amount: row.purchase.totalAmount.toFixed(2), reason: row.reason })),
    data: rows.map((row) => ({ ...row, totalAmount: row.totalAmount.toFixed(2), subtotal: row.subtotal.toFixed(2), discountAmount: row.discountAmount.toFixed(2) })),
    events,
  };
}
export async function expenseReport(from: Date, to: Date) {
  const rows = await reportModel.expenses(from, to);
  const days = new Map<string, Prisma.Decimal>();
  for (const row of rows) {
    const key = bucketDate(row.expenseDate);
    days.set(key, (days.get(key) ?? decimal(0)).add(row.amount));
  }
  return {
    count: rows.length,
    total: sum(rows.map((r) => r.amount)),
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, total: amount.toFixed(2) })),
    data: rows,
  };
}
export async function customerOutstanding() {
  const rows = await reportModel.customerSales();
  const balances = new Map<string, any>();
  for (const row of rows) {
    const customer = row.customer!;
    console.log(customer, "====");

    const x = balances.get(customer.id) ?? {
      ...customer,
      invoiced: decimal(0),
      paid: decimal(0),
    };
    x.invoiced = x.invoiced.add(row.totalAmount.sub(row.returns.reduce((total, salesReturn) => total.add(salesReturn.creditAppliedAmount), decimal(0))));
    x.paid = x.paid.add(sum(row.payments.map((payment) => payment.amount)));
    balances.set(customer.id, x);
  }
  return [...balances.values()]
    .filter((x) => x.invoiced.sub(x.paid).gt(0))
    .map((x) => ({
      ...x,
      outstanding: Prisma.Decimal.max(0, x.invoiced.sub(x.paid)).toFixed(2),
      invoiced: x.invoiced.toFixed(2),
      paid: x.paid.toFixed(2),
    }));
}
export async function supplierOutstanding() {
  const [rows, refunds, credits] = await Promise.all([reportModel.supplierPurchases(), reportModel.supplierRefunds(), reportModel.supplierCredits()]);
  const balances = new Map<string, any>();
  for (const row of rows) {
    const supplier = row.supplier;
    const x = balances.get(supplier.id) ?? {
      ...supplier,
      purchased: decimal(0),
      paid: decimal(0),
      creditApplied: decimal(0),
      supplierCredit: decimal(0),
      refundReceivable: decimal(0),
    };
    x.purchased = x.purchased.add(row.totalAmount);
    x.paid = x.paid.add(sum(row.payments.map((payment) => {
      const reversed = payment.reversals.reduce((total, reversal) => total.add(reversal.amount), decimal(0));
      return Prisma.Decimal.max(decimal(0), payment.amount.sub(reversed));
    })));
    x.creditApplied = x.creditApplied.add(row.supplierCreditApplications.reduce((total, application) => application.reversals.length ? total : total.add(application.amount), decimal(0)));
    balances.set(supplier.id, x);
  }
  for (const credit of credits) {
    const supplier = credit.supplier;
    const x = balances.get(credit.supplierId) ?? { ...supplier, purchased: decimal(0), paid: decimal(0), creditApplied: decimal(0), supplierCredit: decimal(0), refundReceivable: decimal(0) };
    const applied = credit.applications.reduce((total, application) => application.reversals.length ? total : total.add(application.amount), decimal(0));
    const reversed = credit.reversals.reduce((reversalTotal, reversal) => reversalTotal.add(reversal.amount), decimal(0));
    x.supplierCredit = (x.supplierCredit ?? decimal(0)).add(Prisma.Decimal.max(decimal(0), credit.amount.sub(applied).sub(reversed)));
    balances.set(credit.supplierId, x);
  }
  for (const refund of refunds) {
    const supplier = refund.cancellation.purchase.supplier;
    const x = balances.get(supplier.id) ?? { ...supplier, purchased: decimal(0), paid: decimal(0), refundReceivable: decimal(0) };
    const settled = refund.settlements.flatMap((settlement) => settlement.lines).reduce((total, line) => total.add(line.amount), decimal(0));
    x.refundReceivable = x.refundReceivable.add(Prisma.Decimal.max(decimal(0), refund.amount.sub(settled)));
    balances.set(supplier.id, x);
  }
  return [...balances.values()].map((x) => ({
    ...x,
    outstanding: Prisma.Decimal.max(0, x.purchased.sub(x.paid).sub(x.creditApplied ?? decimal(0))).toFixed(2),
    supplierCredit: (x.supplierCredit ?? decimal(0)).toFixed(2),
    refundReceivable: x.refundReceivable.toFixed(2),
    purchased: x.purchased.toFixed(2),
    paid: x.paid.toFixed(2),
  }));
}
export async function monthlySummary(from: Date, to: Date) {
  const [sales, salesReturns, purchases, purchaseCancellations, expenses] = await Promise.all([
    reportModel.sales(from, to),
    reportModel.salesReturns(from, to),
    reportModel.purchases(from, to),
    reportModel.purchaseCancellations(from, to),
    reportModel.expenses(from, to),
  ]);
  const groups = new Map<string, any>();
  const apply = (date: Date, key: string, amount: any) => {
    const bucket = bucketDate(date, true);
    const x = groups.get(bucket) ?? {
      month: bucket,
      sales: decimal(0),
      purchases: decimal(0),
      expenses: decimal(0),
    };
    x[key] = x[key].add(amount);
    groups.set(bucket, x);
  };
  sales.forEach((x) => apply(x.billDate, "sales", x.totalAmount));
  salesReturns.forEach((x) => apply(x.returnedAt, "sales", x.amount.neg()));
  purchases.forEach((x) => apply(x.purchaseDate, "purchases", x.totalAmount));
  purchaseCancellations.forEach((x) => apply(x.cancelledAt, "purchases", x.purchase.totalAmount.neg()));
  expenses.forEach((x) => apply(x.expenseDate, "expenses", x.amount));
  return [...groups.values()].map((x) => ({
    ...x,
    sales: x.sales.toFixed(2),
    purchases: x.purchases.toFixed(2),
    expenses: x.expenses.toFixed(2),
  }));
}
