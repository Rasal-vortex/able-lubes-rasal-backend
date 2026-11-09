import { reportModel } from "./report.model.js";
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
  const rows = await reportModel.sales(from, to);
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
  return {
    totals: {
      invoices: rows.length,
      sales: sum(rows.map((r) => r.totalAmount)),
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
      date: row.billDate,
      customer: row.customer?.name ?? "Walk-in customer",
      total: row.totalAmount.toFixed(2),
      items: row.items.map((item) => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity.toString(),
        unitName: item.unitNameSnapshot,
        unitSymbol: item.unitSymbolSnapshot,
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
  const payments = await reportModel.dailyPayments(from, to);
  const bySale = new Map<string, any>();
  const byMethod = new Map<string, Prisma.Decimal>();
  let collected = decimal(0);
  for (const payment of payments) {
    const sale = payment.sale;
    if (!sale) continue;
    const bill = bySale.get(sale.id) ?? {
      invoiceNumber: sale.invoiceNumber,
      billDate: sale.billDate,
      customer: sale.customer?.name ?? "Walk-in customer",
      products: sale.items.map((item) => ({
        productId: item.product.id, productName: item.product.name,
        quantity: item.quantity.toString(), unitName: item.unitNameSnapshot,
        unitSymbol: item.unitSymbolSnapshot,
        unitSellingPrice: item.unitSellingPrice.toFixed(2),
        discountAmount: item.discountAmount.toFixed(2), lineTotal: item.lineTotal.toFixed(2),
      })),
      payments: [],
    };
    bill.payments.push({ id: payment.id, method: payment.method, amount: payment.amount.toFixed(2), date: payment.paymentDate });
    bySale.set(sale.id, bill);
    collected = collected.add(payment.amount);
    byMethod.set(payment.method, (byMethod.get(payment.method) ?? decimal(0)).add(payment.amount));
  }
  return {
    date,
    totals: {
      collected: collected.toFixed(2),
      byMethod: [...byMethod.entries()].map(([method, amount]) => ({ method, amount: amount.toFixed(2) })),
    },
    invoices: [...bySale.values()],
  };
}

export async function profitReport(from: Date, to: Date) {
  const rows = await reportModel.sales(from, to);
  const expenses = await reportModel.expenses(from, to);
  let totalProfit = decimal(0);
  const invoices = rows.map((sale) => {
    const lineRevenueTotal = sale.items.reduce((value, item) => value.add(item.lineTotal), decimal(0));
    const items = sale.items.map((item) => {
      const costRate = item.historicalCostSnapshot ?? item.product.purchaseRate;
      const cost = costRate.mul(item.quantity);
      // Allocate invoice-level discounts proportionally so item profit sums to
      // the actual billed total, while line discounts are already in lineTotal.
      const saleAmount = lineRevenueTotal.gt(0)
        ? sale.totalAmount.mul(item.lineTotal).div(lineRevenueTotal)
        : item.lineTotal;
      const profit = saleAmount.sub(cost);
      totalProfit = totalProfit.add(profit);
      return {
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity.toString(),
        saleAmount: saleAmount.toFixed(2),
        purchaseRate: costRate.toFixed(2),
        cost: cost.toFixed(2),
        profit: profit.toFixed(2),
      };
    });
    return { invoiceNumber: sale.invoiceNumber, date: sale.billDate, items };
  });
  const totalExpenses = decimal(sum(expenses.map((row) => row.amount)));
  return {
    totals: {
      totalProfit: totalProfit.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      finalProfit: totalProfit.sub(totalExpenses).toFixed(2),
    },
    invoices,
  };
}

export async function supplierLedger(id: string) {
  const supplier = await reportModel.supplier(id);
  if (!supplier) throw new ApiError(404, "Supplier not found");
  let billed = decimal(0);
  let paid = decimal(0);
  const purchases = supplier.purchases.map((purchase) => {
    const purchasePaid = purchase.payments.reduce((value, payment) => value.add(payment.amount), decimal(0));
    billed = billed.add(purchase.totalAmount);
    paid = paid.add(purchasePaid);
    return {
      purchaseNumber: purchase.purchaseNumber,
      date: purchase.purchaseDate,
      total: purchase.totalAmount.toFixed(2),
      paid: purchasePaid.toFixed(2),
      outstanding: Prisma.Decimal.max(decimal(0), purchase.totalAmount.sub(purchasePaid)).toFixed(2),
      payments: purchase.payments.map((payment) => ({
        id: payment.id, amount: payment.amount.toFixed(2), method: payment.method, date: payment.paymentDate,
      })),
    };
  });
  return {
    supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
    totals: { billed: billed.toFixed(2), paid: paid.toFixed(2), outstanding: Prisma.Decimal.max(decimal(0), billed.sub(paid)).toFixed(2) },
    purchases,
  };
}
export async function purchaseReport(from: Date, to: Date) {
  const rows = await reportModel.purchases(from, to);
  return {
    count: rows.length,
    total: sum(rows.map((r) => r.totalAmount)),
    data: rows,
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
    x.invoiced = x.invoiced.add(row.totalAmount);
    x.paid = x.paid.add(sum(row.payments.map((p) => p.amount)));
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
  const rows = await reportModel.supplierPurchases();
  const balances = new Map<string, any>();
  for (const row of rows) {
    const supplier = row.supplier;
    const x = balances.get(supplier.id) ?? {
      ...supplier,
      purchased: decimal(0),
      paid: decimal(0),
    };
    x.purchased = x.purchased.add(row.totalAmount);
    x.paid = x.paid.add(sum(row.payments.map((p) => p.amount)));
    balances.set(supplier.id, x);
  }
  return [...balances.values()].map((x) => ({
    ...x,
    outstanding: Prisma.Decimal.max(0, x.purchased.sub(x.paid)).toFixed(2),
    purchased: x.purchased.toFixed(2),
    paid: x.paid.toFixed(2),
  }));
}
export async function monthlySummary(from: Date, to: Date) {
  const [sales, purchases, expenses] = await Promise.all([
    reportModel.sales(from, to),
    reportModel.purchases(from, to),
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
  purchases.forEach((x) => apply(x.purchaseDate, "purchases", x.totalAmount));
  expenses.forEach((x) => apply(x.expenseDate, "expenses", x.amount));
  return [...groups.values()].map((x) => ({
    ...x,
    sales: x.sales.toFixed(2),
    purchases: x.purchases.toFixed(2),
    expenses: x.expenses.toFixed(2),
  }));
}
