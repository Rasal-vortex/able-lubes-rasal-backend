import { prisma } from "../../config/prisma.js";

export const dashboardModel = {
  todaySales: (from: Date, to: Date) => prisma.sale.aggregate({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
    _sum: { totalAmount: true },
  }),
  todaySalesReturns: (from: Date, to: Date) => prisma.salesReturn.aggregate({ where: { returnedAt: { gte: from, lt: to } }, _sum: { amount: true } }),
  todayExpenses: (from: Date, to: Date) => prisma.expense.aggregate({
    where: { expenseDate: { gte: from, lt: to } },
    _sum: { amount: true },
  }),
  todayPayments: (from: Date, to: Date) => prisma.customerPayment.aggregate({
    where: { paymentDate: { gte: from, lt: to }, method: { in: ["CASH", "UPI"] }, sale: { status: "POSTED" } },
    _sum: { amount: true },
  }),
  todayVerifiedCancellationPayments: (from: Date, to: Date) => prisma.saleCancellation.aggregate({
    where: { cancelledAt: { gte: from, lt: to } },
    _sum: { actualReceivedAmount: true },
  }),
  monthSales: (from: Date, to: Date) => prisma.sale.count({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
  }),
  chartSales: (from: Date, to: Date) => prisma.sale.findMany({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
    select: { billDate: true, totalAmount: true, payments: { select: { amount: true } } },
    orderBy: { billDate: "asc" },
  }),
  chartReturns: (from: Date, to: Date) => prisma.salesReturn.findMany({
    where: { returnedAt: { gte: from, lt: to } },
    select: { amount: true, returnedAt: true, sale: { select: { totalAmount: true, payments: { select: { amount: true, method: true } } } } },
  }),
  latestSales: () => prisma.sale.findMany({
    where: { status: "POSTED" },
    select: {
      invoiceNumber: true,
      customer: { select: { name: true } },
      totalAmount: true,
      billDate: true,
      returns: { select: { amount: true } },
      payments: { select: { method: true } },
    },
    orderBy: { billDate: "desc" },
    take: 4,
  }),
};
