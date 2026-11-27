import { prisma } from "../../config/prisma.js";
export const reportModel = {
  sales: (from: Date, to: Date, includeSettled = false) =>
    prisma.sale.findMany({
      where: {
        status: "POSTED",
        ...(includeSettled
          ? { OR: [{ billDate: { gte: from, lte: to } }, { settledAt: { gte: from, lte: to } }] }
          : { billDate: { gte: from, lte: to } }),
      },
      select: {
        id: true,
        invoiceNumber: true,
        billDate: true,
        settledAt: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        returnStatus: true,
        creditBill: { select: { id: true } },
        customer: { select: { id: true, name: true } },
        items: {
          select: {
            id: true, quantity: true, displayQuantity: true, displayUnitNameSnapshot: true, displayUnitSymbolSnapshot: true, unitSellingPrice: true, discountAmount: true,
            lineTotal: true, historicalCostSnapshot: true,
            costSnapshotSource: true,
            inventoryBatch: { select: { purchaseRate: true } },
            unitNameSnapshot: true, unitSymbolSnapshot: true,
            product: { select: { id: true, name: true, purchaseRate: true } },
            returns: { select: { quantity: true, amount: true, costAmount: true, salesReturn: { select: { returnedAt: true } } } },
          },
        },
        payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
        returns: { select: { amount: true, returnedAt: true, items: { select: { saleItemId: true, quantity: true, amount: true, costAmount: true } } } },
      },
      orderBy: { billDate: "asc" },
    }),
  salesReturns: (from: Date, to: Date) => prisma.salesReturn.findMany({
    where: { returnedAt: { gte: from, lte: to } },
    select: {
      id: true, saleId: true, amount: true, returnedAt: true, reason: true,
      sale: { select: { id: true, invoiceNumber: true, billDate: true, settledAt: true, creditBill: { select: { id: true } }, customer: { select: { name: true } } } },
      items: { select: {
        saleItemId: true, quantity: true, amount: true, costAmount: true,
        saleItem: {
          select: {
            historicalCostSnapshot: true,
            costSnapshotSource: true,
            inventoryBatch: { select: { purchaseRate: true } },
            product: { select: { id: true, name: true, purchaseRate: true } },
          },
        },
      } },
    },
    orderBy: { returnedAt: "asc" },
  }),
  purchases: (from: Date, to: Date) =>
    prisma.purchase.findMany({
      where: { status: { in: ["POSTED", "CANCELLED"] }, purchaseDate: { gte: from, lte: to } },
      select: {
        id: true,
        purchaseNumber: true,
        supplierInvoiceNumber: true,
        purchaseDate: true,
        subtotal: true,
        discountAmount: true,
        totalAmount: true,
        status: true,
        supplier: { select: { name: true } },
        cancellation: { select: { reason: true, cancelledAt: true } },
      },
      orderBy: { purchaseDate: "asc" },
    }),
  purchaseCancellations: (from: Date, to: Date) => prisma.purchaseCancellation.findMany({
    where: { cancelledAt: { gte: from, lte: to } },
    select: { id: true, reason: true, cancelledAt: true, purchase: { select: { id: true, purchaseNumber: true, supplierInvoiceNumber: true, purchaseDate: true, totalAmount: true, supplier: { select: { name: true } } } } },
    orderBy: { cancelledAt: "asc" },
  }),
  expenses: (from: Date, to: Date) =>
    prisma.expense.findMany({
      where: { expenseDate: { gte: from, lte: to } },
      select: { expenseDate: true, amount: true },
    }),
  dailyPayments: (from: Date, to: Date) => prisma.customerPayment.findMany({
    where: { paymentDate: { gte: from, lt: to }, method: { not: "COUPON" }, sale: { status: "POSTED" } },
    select: {
      id: true, amount: true, method: true, paymentDate: true, notes: true,
      sale: {
        select: {
          id: true, invoiceNumber: true, billDate: true, totalAmount: true, discountAmount: true,
          returnStatus: true,
          customer: { select: { id: true, name: true } },
          items: { select: {
            id: true, quantity: true, displayQuantity: true, displayUnitNameSnapshot: true, displayUnitSymbolSnapshot: true, unitSellingPrice: true, discountAmount: true,
            lineTotal: true, unitNameSnapshot: true, unitSymbolSnapshot: true,
            product: { select: { id: true, name: true } },
            returns: { select: { quantity: true, amount: true } },
          } },
        },
      },
    },
    orderBy: { paymentDate: "asc" },
  }),
  dailyRefunds: (from: Date, to: Date) => prisma.saleRefund.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: {
      id: true, amount: true, method: true, reference: true, originalPaymentId: true, createdAt: true,
      cancellation: { select: { sale: { select: { invoiceNumber: true, customer: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: "asc" },
  }),
  dailyInvoices: (from: Date, to: Date) => prisma.sale.findMany({
    where: { status: "POSTED", billDate: { gte: from, lt: to } },
    select: {
      id: true, invoiceNumber: true, billDate: true, totalAmount: true, discountAmount: true, returnStatus: true,
      customer: { select: { id: true, name: true } },
      items: { select: {
        id: true, productId: true, quantity: true, displayQuantity: true, displayUnitNameSnapshot: true, displayUnitSymbolSnapshot: true,
        unitSellingPrice: true, discountAmount: true, lineTotal: true, unitNameSnapshot: true, unitSymbolSnapshot: true,
        product: { select: { id: true, name: true } },
        returns: { select: { quantity: true, amount: true } },
      } },
      payments: { select: { id: true, amount: true, method: true, paymentDate: true, notes: true } },
      returns: { select: { amount: true, returnedAt: true, items: { select: { saleItemId: true, quantity: true, amount: true, costAmount: true } } } },
    },
    orderBy: { billDate: "asc" },
  }),
  dailySalesReturns: (from: Date, to: Date) => prisma.salesReturn.findMany({
    where: { returnedAt: { gte: from, lt: to } },
    select: {
      id: true, reason: true, returnedAt: true, amount: true, creditAppliedAmount: true, settlementType: true,
      returnedBy: { select: { name: true } },
      sale: { select: { invoiceNumber: true, customer: { select: { name: true } } } },
      settlements: { select: { id: true, type: true, amount: true, method: true, reference: true, createdAt: true } },
    },
    orderBy: { returnedAt: "asc" },
  }),
  dailyReturnRefunds: (from: Date, to: Date) => prisma.salesReturnSettlement.findMany({
    where: { type: "REFUND", createdAt: { gte: from, lt: to } },
    select: { id: true, amount: true, method: true, reference: true, createdAt: true, salesReturn: { select: { sale: { select: { invoiceNumber: true, customer: { select: { name: true } } } } } } },
    orderBy: { createdAt: "asc" },
  }),
  dailyPaymentCorrections: (from: Date, to: Date) => prisma.saleCancellation.findMany({
    where: { cancelledAt: { gte: from, lt: to } },
    select: {
      id: true, reason: true, collectedAmount: true, actualReceivedAmount: true,
      creditReversedAmount: true,
      pendingAmount: true, cancelledAt: true,
      cancelledBy: { select: { name: true } },
      sale: { select: {
        id: true, invoiceNumber: true, totalAmount: true, paymentStatus: true,
        customer: { select: { name: true } },
        creditBill: { select: { id: true } },
        returns: { select: { creditAppliedAmount: true } },
        payments: { select: { id: true, amount: true, method: true } },
      } },
      refunds: { select: { id: true, amount: true, method: true, reference: true, createdAt: true } },
      paymentCorrections: { select: {
        id: true, type: true, amount: true, method: true, reason: true,
        originalPaymentId: true, createdAt: true,
      } },
    },
    orderBy: { cancelledAt: "asc" },
  }),
  supplier: (id: string) => prisma.supplier.findUnique({
    where: { id },
    select: {
      id: true, name: true, phone: true,
      purchases: {
      select: {
          id: true, purchaseNumber: true, purchaseDate: true, totalAmount: true, status: true, createdAt: true,
          supplierInvoiceNumber: true,
          items: {
            select: {
              id: true, purchaseId: true, productId: true, quantity: true, supplierRate: true, lineTotal: true,
              unitNameSnapshot: true, unitSymbolSnapshot: true,
              product: { select: { id: true, name: true } },
              inventoryBatch: { select: { id: true, productId: true, purchaseItemId: true, source: true, status: true, receivedQuantity: true, remainingQuantity: true, saleItems: { select: { id: true } }, stockMovements: { select: { id: true } } } },
            },
          },
          payments: { select: { id: true, paymentGroupId: true, amount: true, method: true, paymentDate: true, receiptNumber: true, reversals: { select: { amount: true, reason: true, createdAt: true } }, transferDecisions: { select: { wasTransferred: true, cancellation: { select: { purchaseId: true, cancelledAt: true } } } } } },
          supplierCreditApplications: { select: { id: true, creditId: true, amount: true, reversals: { select: { amount: true } } } },
          cancellation: { select: { reason: true, cancelledAt: true, cancelledBy: { select: { id: true, name: true } }, paymentReversals: { select: { originalPaymentId: true, amount: true } }, supplierRefund: { select: { id: true, amount: true, settlements: { select: { id: true, idempotencyKey: true, settledAt: true, lines: { select: { amount: true, method: true, reference: true, originalPaymentId: true, originalPayment: { select: { method: true, receiptNumber: true } } } } } } } } } },
        },
        orderBy: [
          { purchaseDate: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      },
    },
  }),
  customerSales: () =>
    prisma.sale.findMany({
      where: { status: "POSTED", customerId: { not: null } },
      select: {
        customerId: true,
        totalAmount: true,
        returns: { select: { creditAppliedAmount: true } },
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
        payments: { select: { amount: true, reversals: { select: { amount: true } } } },
        supplierCreditApplications: { select: { amount: true, reversals: { select: { amount: true } } } },
      },
    }),
  supplierCredits: (supplierId?: string) => prisma.supplierCredit.findMany({
    where: supplierId ? { supplierId } : undefined,
    select: { id: true, supplierId: true, amount: true, createdAt: true, sourcePaymentId: true, supplier: { select: { id: true, name: true, phone: true } }, applications: { select: { amount: true, reversals: { select: { amount: true } } } }, reversals: { select: { amount: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }),
  supplierRefunds: (supplierId?: string) => prisma.supplierRefund.findMany({
    where: supplierId ? { cancellation: { purchase: { supplierId } } } : undefined,
    select: {
      id: true,
      amount: true,
      cancellation: { select: { cancelledAt: true, purchase: { select: { supplierId: true, supplier: { select: { id: true, name: true, phone: true } } } } } },
      settlements: { select: { settledAt: true, lines: { select: { amount: true, method: true, reference: true } } } },
    },
  }),
};
