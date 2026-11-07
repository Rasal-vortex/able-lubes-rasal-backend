import { Prisma } from "../../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import { reportModel } from "../reports/report.model.js";
import { dashboardModel } from "./dashboard.model.js";

const zero = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal | null | undefined) => (value ?? zero).toFixed(2);

function localDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.BUSINESS_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

// Convert a business-local midnight to its corresponding UTC instant.
function localMidnight(year: number, month: number, day: number) {
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  for (let i = 0; i < 2; i++) {
    const parts = localDateParts(new Date(instant));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
    instant = target - (represented - instant);
  }
  return new Date(instant);
}

function dateKey(date: Date) {
  const p = localDateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function monthBounds(month: string | undefined, now: Date) {
  const p = month?.split("-").map(Number) ?? (() => {
    const current = localDateParts(now);
    return [Number(current.year), Number(current.month)];
  })();
  const [year, monthNumber] = p;
  return {
    year, month: monthNumber,
    from: localMidnight(year, monthNumber, 1),
    to: localMidnight(year, monthNumber + 1, 1),
    days: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate(),
  };
}

export async function dashboardSummary(month: string | undefined) {
  const now = new Date();
  const today = localDateParts(now);
  const todayFrom = localMidnight(Number(today.year), Number(today.month), Number(today.day));
  const tomorrow = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + 1));
  const todayTo = localMidnight(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate());
  const range = monthBounds(month, now);
  const currentMonthRange = monthBounds(undefined, now);

  const [sales, expenses, payments, monthSalesCount, chartSales, latestSales, customerRows, supplierRows] = await Promise.all([
    dashboardModel.todaySales(todayFrom, todayTo),
    dashboardModel.todayExpenses(todayFrom, todayTo),
    dashboardModel.todayPayments(todayFrom, todayTo),
    dashboardModel.monthSales(currentMonthRange.from, currentMonthRange.to),
    dashboardModel.chartSales(range.from, range.to),
    dashboardModel.latestSales(),
    reportModel.customerSales(),
    reportModel.supplierPurchases(),
  ]);

  const daily = new Map<string, { paidSales: Prisma.Decimal; creditSales: Prisma.Decimal }>();
  for (let day = 1; day <= range.days; day++) {
    const key = `${range.year}-${String(range.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    daily.set(key, { paidSales: zero, creditSales: zero });
  }
  for (const sale of chartSales) {
    const key = dateKey(sale.billDate);
    const bucket = daily.get(key)!;
    const paid = sale.payments.reduce((sum, payment) => sum.add(payment.amount), zero);
    const total = sale.totalAmount;
    bucket.paidSales = bucket.paidSales.add(Prisma.Decimal.min(total, paid));
    bucket.creditSales = bucket.creditSales.add(Prisma.Decimal.max(zero, total.sub(paid)));
  }

  const outstanding = (rows: any[], invoiceField: "totalAmount") => rows.reduce((sum, row) => {
    const paid = row.payments.reduce((n: Prisma.Decimal, payment: any) => n.add(payment.amount), zero);
    return sum.add(Prisma.Decimal.max(zero, row[invoiceField].sub(paid)));
  }, zero);
  const customerOutstanding = outstanding(customerRows, "totalAmount");
  const supplierPayable = supplierRows.reduce((sum, row: any) => {
    const paid = row.payments.reduce((n: Prisma.Decimal, payment: any) => n.add(payment.amount), zero);
    return sum.add(Prisma.Decimal.max(zero, row.totalAmount.sub(paid)));
  }, zero);

  return {
    today: {
      date: `${today.year}-${today.month}-${today.day}`,
      salesTotal: money(sales._sum.totalAmount),
      expensesTotal: money(expenses._sum.amount),
      paymentsCollected: money(payments._sum.amount),
    },
    balances: { customerOutstanding: money(customerOutstanding), supplierPayable: money(supplierPayable) },
    currentMonth: { month: `${today.year}-${today.month}`, salesCount: monthSalesCount },
    chart: {
      month: `${range.year}-${String(range.month).padStart(2, "0")}`,
      days: [...daily.entries()].map(([date, value]) => ({ date, paidSales: money(value.paidSales), creditSales: money(value.creditSales) })),
    },
    latestSales: latestSales.map((sale) => ({
      invoiceNumber: sale.invoiceNumber,
      customerName: sale.customer?.name ?? "Walk-in customer",
      paymentMethod: [...new Set(sale.payments.map((payment) => payment.method))].join(", ") || "CREDIT",
      total: money(sale.totalAmount),
      date: sale.billDate,
    })),
  };
}
