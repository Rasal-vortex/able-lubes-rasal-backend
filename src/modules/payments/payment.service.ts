import { Prisma } from "../../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { paymentModel } from "./payment.model.js";
import { paymentSerializer } from "./payment.serializer.js";
const amount = (value: number | string) => new Prisma.Decimal(value);

export async function recordCustomerPaymentInTransaction(tx: any, input: any) {
  const sale = await paymentModel.sale(input.saleId, tx);
  if (!sale || sale.status !== "POSTED")
    throw new ApiError(404, "Posted sale not found");
  if (input.customerId && sale.customerId !== input.customerId)
    throw new ApiError(400, "Payment customer must match the invoice customer");
  const payments = await paymentModel.salePayments(sale.id, tx);
  const outstanding = sale.totalAmount.sub(
    payments._sum.amount ?? amount(0),
  );
  const paymentAmount = amount(input.amount);
  if (paymentAmount.gt(outstanding))
    throw new ApiError(400, "Payment exceeds the invoice outstanding amount");

  let paymentNotes = input.notes;
  if (input.method === "STORE_CREDIT") {
    if (!sale.customerId)
      throw new ApiError(400, "Store credit requires a registered customer");
    const balances = await tx.customerStoreCreditTransaction.groupBy({
      by: ["type"],
      where: { customerId: sale.customerId },
      _sum: { amount: true },
    });
    const available = balances.reduce(
      (balance: Prisma.Decimal, row: any) => balance.add(
        row.type === "CREDIT"
          ? row._sum.amount ?? amount(0)
          : (row._sum.amount ?? amount(0)).neg(),
      ),
      amount(0),
    );
    if (paymentAmount.gt(available))
      throw new ApiError(400, "Store credit exceeds the customer's available balance");
  }
  if (input.method === "COUPON") {
    const couponCode = /^Coupon code: (.+)$/.exec(input.notes ?? "")?.[1];
    if (couponCode) {
      const recordedCoupon = await tx.coupon.findUnique({
        where: { code: couponCode },
        select: { id: true },
      });
      if (recordedCoupon)
        throw new ApiError(409, "Use an unrecorded coupon code for a split sale payment");
      const priorRedemption = await tx.customerPayment.findFirst({
        where: { method: "COUPON", notes: `Coupon code: ${couponCode}` },
        select: { id: true },
      });
      if (priorRedemption)
        throw new ApiError(409, "This coupon code has already been used");
    } else {
      // Keep code-less coupon value distinct from code-based coupon redemptions.
      paymentNotes = "Coupon payment (no code)";
    }
  }
  const payment = await paymentModel.createCustomerPayment(
    {
      ...input,
      customerId: sale.customerId,
      paymentDate: input.paymentDate ?? new Date(),
      amount: paymentAmount,
      notes: paymentNotes,
    },
    tx,
  );
  if (input.method === "STORE_CREDIT") {
    await tx.customerStoreCreditTransaction.create({
      data: {
        customerId: sale.customerId!,
        type: "DEBIT",
        amount: paymentAmount,
        saleId: sale.id,
        paymentId: payment.id,
      },
    });
  }
  await paymentModel.setSalePaymentStatus(
    sale.id,
    paymentAmount.eq(outstanding) ? "PAID" : "PARTIALLY_PAID",
    tx,
  );
  return paymentSerializer(payment);
}

export async function recordCustomerPayment(input: any) {
  return prisma.$transaction(
    (tx) => recordCustomerPaymentInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function recordSupplierPayment(input: any) {
  return prisma.$transaction(
    async (tx) => {
      const selectedPurchase = await tx.purchase.findUnique({
        where: { id: input.purchaseId },
        select: { id: true, supplierId: true, status: true },
      });
      if (!selectedPurchase || selectedPurchase.status !== "POSTED")
        throw new ApiError(404, "Posted purchase not found");
      if (selectedPurchase.supplierId !== input.supplierId)
        throw new ApiError(
          400,
          "Payment supplier must match the purchase supplier",
        );
      const tenders: Array<{ method: "CASH" | "UPI"; amount: Prisma.Decimal }> =
        input.tenders
          ? input.tenders.map(
              (tender: {
                method: "CASH" | "UPI";
                amount: number | string;
              }) => ({
                method: tender.method,
                amount: amount(tender.amount),
              }),
            )
          : [{ method: input.method, amount: amount(input.amount) }];
      const paymentAmount = tenders.reduce(
        (total, tender) => total.add(tender.amount),
        amount(0),
      );
      const purchases = await tx.purchase.findMany({
        where: { supplierId: input.supplierId, status: "POSTED" },
        orderBy: [{ purchaseDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          payments: { select: { amount: true, reversals: { select: { amount: true } } } },
          supplierCreditApplications: { select: { amount: true, reversals: { select: { id: true } } } },
        },
      });
      const outstandingByPurchase = new Map<string, Prisma.Decimal>();
      for (const purchase of purchases) {
        const alreadyPaid = purchase.payments.reduce(
          (total, payment) => total.add(Prisma.Decimal.max(amount(0), payment.amount.sub(payment.reversals.reduce((reversed, row) => reversed.add(row.amount), amount(0))))),
          amount(0),
        );
        const creditApplied = purchase.supplierCreditApplications.reduce(
          (total, application) => application.reversals.length ? total : total.add(application.amount),
          amount(0),
        );
        outstandingByPurchase.set(
          purchase.id,
          Prisma.Decimal.max(amount(0), purchase.totalAmount.sub(alreadyPaid).sub(creditApplied)),
        );
      }
      const allocations: Array<{
        purchaseId: string;
        purchaseNumber: string;
        method: "CASH" | "UPI";
        amount: Prisma.Decimal;
      }> = [];
      for (const tender of tenders) {
        let remainingTender = tender.amount;
        for (const purchase of purchases) {
          const outstanding =
            outstandingByPurchase.get(purchase.id) ?? amount(0);
          if (outstanding.isZero()) continue;
          const allocation = Prisma.Decimal.min(outstanding, remainingTender);
          if (allocation.gt(0)) {
            allocations.push({
              purchaseId: purchase.id,
              purchaseNumber: purchase.purchaseNumber,
              method: tender.method,
              amount: allocation,
            });
            outstandingByPurchase.set(purchase.id, outstanding.sub(allocation));
            remainingTender = remainingTender.sub(allocation);
          }
          if (remainingTender.isZero()) break;
        }
        if (remainingTender.gt(0))
          throw new ApiError(
            400,
            "Payment exceeds this supplier's total outstanding balance",
          );
      }
      // Serialize payment allocation against purchase cancellation by writing
      // the same purchase rows, conditionally requiring them to remain posted.
      for (const purchaseId of [...new Set(allocations.map((allocation) => allocation.purchaseId))]) {
        const locked = await tx.purchase.updateMany({
          where: { id: purchaseId, status: "POSTED" },
          data: { updatedAt: new Date() },
        });
        if (locked.count !== 1)
          throw new ApiError(409, "A purchase changed while recording payment; refresh and retry");
      }
      const paymentGroupId = randomUUID();
      const payments = await Promise.all(
        allocations.map((allocation) =>
          tx.supplierPayment.create({
            data: {
              supplierId: input.supplierId,
              purchaseId: allocation.purchaseId,
              paymentGroupId,
              amount: allocation.amount,
              paymentDate: input.paymentDate ?? new Date(),
              method: allocation.method,
              notes: input.notes,
              receiptNumber: input.receiptNumber,
            },
          }),
        ),
      );
      return {
        paymentGroupId,
        supplierId: input.supplierId,
        amount: paymentAmount.toFixed(2),
        allocations: allocations.map((allocation) => ({
          purchaseId: allocation.purchaseId,
          purchaseNumber: allocation.purchaseNumber,
          method: allocation.method,
          amount: allocation.amount.toFixed(2),
        })),
        payments: payments.map(paymentSerializer),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
