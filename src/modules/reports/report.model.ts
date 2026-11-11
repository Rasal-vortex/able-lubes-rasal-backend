import { prisma } from "../../config/prisma.js";
export const reportModel = {
  sales: (from: Date, to: Date) =>
    prisma.sale.findMany({
      where: { status: "POSTED", billDate: { gte: from, lte: to } },
      select: {
        id: true,
        invoiceNumber: true,
        billDate: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        customer: { select: { id: true, name: true } },
        items: {
          select: {
            id: true, quantity: true, displayQuantity: true, displayUnitNameSnapshot: true, displayUnitSymbolSnapshot: true, unitSellingPrice: true, discountAmount: true,
            lineTotal: true, historicalCostSnapshot: true,
            unitNameSnapshot: true, unitSymbolSnapshot: true,
            product: { select: { id: true, name: true, purchaseRate: true } },
          },
        },
        payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
      },
      orderBy: { billDate: "asc" },
    }),
  purchases: (from: Date, to: Date) =>
    prisma.purchase.findMany({
      where: { status: "POSTED", purchaseDate: { gte: from, lte: to } },
      select: {
        purchaseDate: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
      },
      orderBy: { purchaseDate: "asc" },
    }),
  expenses: (from: Date, to: Date) =>
    prisma.expense.findMany({
      where: { expenseDate: { gte: from, lte: to } },
      select: { expenseDate: true, amount: true },
    }),
  dailyPayments: (from: Date, to: Date) => prisma.customerPayment.findMany({
    where: { paymentDate: { gte: from, lt: to }, sale: { status: "POSTED" } },
    select: {
      id: true, amount: true, method: true, paymentDate: true, notes: true,
      sale: {
        select: {
          id: true, invoiceNumber: true, billDate: true, totalAmount: true, discountAmount: true,
          customer: { select: { id: true, name: true } },
          items: { select: {
            id: true, quantity: true, displayQuantity: true, displayUnitNameSnapshot: true, displayUnitSymbolSnapshot: true, unitSellingPrice: true, discountAmount: true,
            lineTotal: true, unitNameSnapshot: true, unitSymbolSnapshot: true,
            product: { select: { id: true, name: true } },
          } },
        },
      },
    },
    orderBy: { paymentDate: "asc" },
  }),
  supplier: (id: string) => prisma.supplier.findUnique({
    where: { id },
    select: {
      id: true, name: true, phone: true,
      purchases: {
        where: { status: "POSTED" },
        select: {
          id: true, purchaseNumber: true, purchaseDate: true, totalAmount: true,
          payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
        },
        orderBy: { purchaseDate: "desc" },
      },
    },
  }),
  customerSales: () =>
    prisma.sale.findMany({
      where: { status: "POSTED", customerId: { not: null } },
      select: {
        customerId: true,
        totalAmount: true,
        customer: { select: { id: true, name: true, phone: true } },
        payments: { select: { amount: true } },
      },
    }),
  supplierPurchases: () =>
    prisma.purchase.findMany({
      where: { status: "POSTED" },
      select: {
        supplierId: true,
        totalAmount: true,
        supplier: { select: { id: true, name: true, phone: true } },
        payments: { select: { amount: true } },
      },
    }),
};
