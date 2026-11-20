import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { cancelCreditBillSale as cancelSaleForBill, settleCreditBillRefund as settleRefundForBill } from "../transactions/transaction.service.js";

const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function serializeCreditBill(row: any) {
  const returnTotal = row.sale?.returns?.reduce((total: Prisma.Decimal, salesReturn: any) => total.add(salesReturn.creditAppliedAmount), decimal(0)) ?? decimal(0);
  const billAmount = row.sale ? Prisma.Decimal.max(decimal(0), row.sale.totalAmount.sub(returnTotal)) : row.billAmount;
  const payments = row.sale?.payments ?? row.payments;
  const paidAmount = payments.reduce(
    (total: Prisma.Decimal, payment: { amount: Prisma.Decimal }) => total.add(payment.amount),
    decimal(0),
  );
  const netDue = Prisma.Decimal.max(decimal(0), billAmount.sub(paidAmount));
  const cancelled = row.sale?.status === "CANCELLED";
  const dueDate = dateOnly(row.dueDate);
  const overdue = netDue.gt(0) && dueDate < dateOnly(new Date());

  return {
    id: row.id,
    saleId: row.saleId,
    customerId: row.customerId,
    partyName: row.customer.name,
    billNumber: row.billNumber,
    billDate: dateOnly(row.billDate),
    dueDate,
    term: row.term,
    status: cancelled ? "Cancelled" : netDue.isZero() ? "Settled" : overdue ? "Overdue" : paidAmount.gt(0) ? "Partially Paid" : "Unpaid",
    priorBalance: row.priorBalance.toFixed(2),
    billAmount: billAmount.toFixed(2),
    paidAmount: paidAmount.toFixed(2),
    netDue: cancelled ? "0.00" : netDue.toFixed(2),
    remarks: row.remarks,
    invoiceReference: row.sale?.invoiceNumber ?? null,
    saleItems: row.sale?.items?.map((item: any) => ({
      productName: item.product.name,
      quantity: (() => {
        const returned = item.returns.reduce((total: Prisma.Decimal, salesReturnItem: any) => total.add(salesReturnItem.quantity), decimal(0));
        const remaining = Prisma.Decimal.max(decimal(0), item.quantity.sub(returned));
        return item.displayQuantity != null && !item.quantity.isZero() ? item.displayQuantity.mul(remaining).div(item.quantity).toString() : remaining.toString();
      })(),
      unitName: item.displayUnitNameSnapshot ?? item.unitNameSnapshot,
      unitSymbol: item.displayUnitSymbolSnapshot ?? item.unitSymbolSnapshot,
    })) ?? [],
    cancelledAt: row.sale?.cancellation?.cancelledAt ?? null,
    cancellationReason: row.sale?.cancellation?.reason ?? null,
    cancelledByName: row.sale?.cancellation?.cancelledBy?.name ?? null,
    actualReceivedAmount: row.sale?.cancellation?.actualReceivedAmount?.toFixed(2) ?? null,
    paymentCorrections: row.sale?.cancellation?.paymentCorrections?.map((correction: any) => ({
      id: correction.id, type: correction.type, amount: correction.amount.toFixed(2),
      method: correction.method, reason: correction.reason, createdAt: correction.createdAt,
      originalPaymentId: correction.originalPaymentId,
    })) ?? [],
    refundPayable: row.sale?.cancellation?.pendingAmount?.toFixed(2) ?? "0.00",
    refunds: row.sale?.cancellation?.refunds?.map((refund: any) => ({
      id: refund.id, amount: refund.amount.toFixed(2), method: refund.method,
      reference: refund.reference, date: refund.createdAt, createdByName: refund.createdBy?.name ?? null,
      originalPaymentId: refund.originalPaymentId,
    })) ?? [],
    payments: payments.map((payment: any) => ({
      id: payment.id,
      amount: payment.amount.toFixed(2),
      method: payment.method,
      date: payment.paymentDate,
    })),
  };
}

const creditBillInclude = {
  customer: { select: { id: true, name: true } },
  sale: { select: {
    id: true, status: true, invoiceNumber: true, totalAmount: true,
    returns: { select: { creditAppliedAmount: true } },
    payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
    items: { select: {
      quantity: true, displayQuantity: true, displayUnitNameSnapshot: true, displayUnitSymbolSnapshot: true,
      unitNameSnapshot: true, unitSymbolSnapshot: true, product: { select: { name: true } },
      returns: { select: { quantity: true } },
    } },
    cancellation: { select: {
      reason: true, cancelledAt: true, pendingAmount: true,
      actualReceivedAmount: true,
      cancelledBy: { select: { name: true } },
      paymentCorrections: { select: { id: true, type: true, amount: true, method: true, reason: true, createdAt: true, originalPaymentId: true }, orderBy: { createdAt: "asc" } },
      refunds: { select: { id: true, amount: true, method: true, reference: true, originalPaymentId: true, createdAt: true, createdBy: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    } },
  } },
  payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
} as const;

export async function listCustomerCreditBills() {
  const rows = await prisma.customerCreditBill.findMany({
    include: creditBillInclude,
    orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeCreditBill);
}

export async function cancelBillingCreditSale(id: string, input: any, userId: string) {
  await cancelSaleForBill(id, input, userId);
  const row = await prisma.customerCreditBill.findUnique({ where: { id }, include: creditBillInclude });
  if (!row) throw new ApiError(404, "Credit bill not found");
  return serializeCreditBill(row);
}

export async function settleBillingCreditRefund(id: string, input: any, userId: string) {
  await settleRefundForBill(id, input, userId);
  const row = await prisma.customerCreditBill.findUnique({ where: { id }, include: creditBillInclude });
  if (!row) throw new ApiError(404, "Credit bill not found");
  return serializeCreditBill(row);
}

export async function createManualCreditBill(input: any) {
  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, active: true },
    select: { id: true },
  });
  if (!customer) throw new ApiError(404, "Active customer not found");

  try {
    const row = await prisma.customerCreditBill.create({
      data: {
        customerId: input.customerId,
        billNumber: input.billNumber,
        billDate: input.billDate,
        dueDate: input.dueDate,
        term: input.term,
        billAmount: decimal(input.billAmount),
        priorBalance: decimal(input.priorBalance ?? 0),
        remarks: input.remarks,
      },
      include: creditBillInclude,
    });
    return serializeCreditBill(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new ApiError(409, "This credit bill number already exists");
    throw error;
  }
}

export async function recordManualCreditBillPayment(id: string, input: any) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.customerCreditBill.findUnique({
      where: { id },
      include: { sale: true, payments: { select: { amount: true } } },
    });
    if (!bill) throw new ApiError(404, "Credit bill not found");
    if (bill.saleId) throw new ApiError(400, "Record payments against the linked sale");
    const paid = bill.payments.reduce((total, payment) => total.add(payment.amount), decimal(0));
    const outstanding = Prisma.Decimal.max(decimal(0), bill.billAmount.sub(paid));
    const paymentAmount = decimal(input.amount);
    if (paymentAmount.gt(outstanding)) throw new ApiError(400, "Payment exceeds this credit bill's outstanding amount");

    await tx.customerCreditBillPayment.create({
      data: {
        creditBillId: id,
        amount: paymentAmount,
        paymentDate: input.paymentDate ?? new Date(),
        method: input.method,
        notes: input.notes,
      },
    });
    const updated = await tx.customerCreditBill.findUniqueOrThrow({
      where: { id },
      include: creditBillInclude,
    });
    return serializeCreditBill(updated);
  });
}

export async function deleteManualCreditBill(id: string) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.customerCreditBill.findUnique({
      where: { id },
      select: { id: true, saleId: true },
    });
    if (!bill) throw new ApiError(404, "Credit bill not found");
    if (bill.saleId) {
      throw new ApiError(409, "Credit bills linked to sales cannot be deleted here");
    }

    const deleted = await tx.customerCreditBill.deleteMany({
      where: { id, saleId: null, payments: { none: {} } },
    });
    if (deleted.count !== 1) {
      throw new ApiError(409, "Credit bills with payment history cannot be deleted");
    }
    return { id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
