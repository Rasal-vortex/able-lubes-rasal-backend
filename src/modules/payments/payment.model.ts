import { prisma } from "../../config/prisma.js";
export const paymentModel = {
  sale: (id: string, db: any = prisma) => db.sale.findUnique({ where: { id } }),
  salePayments: (id: string, db: any = prisma) =>
    db.customerPayment.aggregate({
      where: { saleId: id },
      _sum: { amount: true },
    }),
  createCustomerPayment: (data: any, db: any = prisma) =>
    db.customerPayment.create({ data }),
  setSalePaymentStatus: (
    id: string,
    status: "PAID" | "PARTIALLY_PAID",
    db: any = prisma,
    settledAt?: Date,
  ) => db.sale.update({ where: { id }, data: { paymentStatus: status, ...(settledAt ? { settledAt } : {}) } }),
  purchase: (id: string, db: any = prisma) =>
    db.purchase.findUnique({ where: { id } }),
  purchasePayments: (id: string, db: any = prisma) =>
    db.supplierPayment.aggregate({
      where: { purchaseId: id },
      _sum: { amount: true },
    }),
  createSupplierPayment: (data: any, db: any = prisma) =>
    db.supplierPayment.create({ data }),
};
