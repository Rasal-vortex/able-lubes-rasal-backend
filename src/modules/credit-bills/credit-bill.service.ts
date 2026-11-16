import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";

const decimal = (value: Prisma.Decimal | number | string) => new Prisma.Decimal(value);
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

function serializeCreditBill(row: any) {
  const billAmount = row.sale?.totalAmount ?? row.billAmount;
  const payments = row.sale?.payments ?? row.payments;
  const paidAmount = payments.reduce(
    (total: Prisma.Decimal, payment: { amount: Prisma.Decimal }) => total.add(payment.amount),
    decimal(0),
  );
  const netDue = Prisma.Decimal.max(decimal(0), billAmount.sub(paidAmount));
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
    status: netDue.isZero() ? "Settled" : overdue ? "Overdue" : paidAmount.gt(0) ? "Partially Paid" : "Unpaid",
    priorBalance: row.priorBalance.toFixed(2),
    billAmount: billAmount.toFixed(2),
    paidAmount: paidAmount.toFixed(2),
    netDue: netDue.toFixed(2),
    remarks: row.remarks,
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
  sale: { select: { status: true, totalAmount: true, payments: { select: { id: true, amount: true, method: true, paymentDate: true } } } },
  payments: { select: { id: true, amount: true, method: true, paymentDate: true } },
} as const;

export async function listCustomerCreditBills() {
  const rows = await prisma.customerCreditBill.findMany({
    where: { OR: [{ saleId: null }, { sale: { status: "POSTED" } }] },
    include: creditBillInclude,
    orderBy: [{ billDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(serializeCreditBill);
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
