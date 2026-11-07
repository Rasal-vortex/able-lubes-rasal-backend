import { prisma } from "../../config/prisma.js";

export const dashboardModel = {
  todaySales: (from: Date, to: Date) => prisma.sale.aggregate({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
    _sum: { totalAmount: true },
  }),
  todayExpenses: (from: Date, to: Date) => prisma.expense.aggregate({
    where: { expenseDate: { gte: from, lt: to } },
    _sum: { amount: true },
  }),
  todayPayments: (from: Date, to: Date) => prisma.customerPayment.aggregate({
    where: { paymentDate: { gte: from, lt: to } },
    _sum: { amount: true },
  }),
  monthSales: (from: Date, to: Date) => prisma.sale.count({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
  }),
  chartSales: (from: Date, to: Date) => prisma.sale.findMany({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
    select: { billDate: true, totalAmount: true, payments: { select: { amount: true } } },
    orderBy: { billDate: "asc" },
  }),
  latestSales: () => prisma.sale.findMany({
    where: { status: "POSTED" },
    select: {
      invoiceNumber: true,
      customer: { select: { name: true } },
      totalAmount: true,
      billDate: true,
      payments: { select: { method: true } },
    },
    orderBy: { billDate: "desc" },
    take: 4,
  }),
};
