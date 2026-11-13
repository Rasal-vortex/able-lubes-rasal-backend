import { Prisma } from "../../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { paymentModel } from "./payment.model.js";
import { paymentSerializer } from "./payment.serializer.js";
const amount = (value: number | string) => new Prisma.Decimal(value);

export async function recordCustomerPayment(input: any) {
  return prisma.$transaction(
    async (tx) => {
      const sale = await paymentModel.sale(input.saleId, tx);
      if (!sale || sale.status !== "POSTED")
        throw new ApiError(404, "Posted sale not found");
      if (input.customerId && sale.customerId !== input.customerId)
        throw new ApiError(
          400,
          "Payment customer must match the invoice customer",
        );
      const payments = await paymentModel.salePayments(sale.id, tx);
      const outstanding = sale.totalAmount.sub(
        payments._sum.amount ?? amount(0),
      );
      const paymentAmount = amount(input.amount);
      if (paymentAmount.gt(outstanding))
        throw new ApiError(
          400,
          "Payment exceeds the invoice outstanding amount",
        );
      let paymentNotes = input.notes;
      if (input.method === "COUPON") {
        const couponCode = /^Coupon code: (.+)$/.exec(input.notes ?? "")?.[1];
        if (couponCode) {
          const recordedCoupon = await tx.coupon.findUnique({
            where: { code: couponCode },
            select: { id: true },
          });
          if (recordedCoupon)
            throw new ApiError(
              409,
              "Use an unrecorded coupon code for a split sale payment",
            );
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
      await paymentModel.setSalePaymentStatus(
        sale.id,
        paymentAmount.eq(outstanding) ? "PAID" : "PARTIALLY_PAID",
        tx,
      );
      return paymentSerializer(payment);
    },
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
      const paymentAmount = amount(input.amount);
      const purchases = await tx.purchase.findMany({
        where: { supplierId: input.supplierId, status: "POSTED" },
        orderBy: [
          { purchaseDate: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
        include: { payments: { select: { amount: true } } },
      });
      let remainingPayment = paymentAmount;
      const allocations: Array<{
        purchaseId: string;
        purchaseNumber: string;
        amount: Prisma.Decimal;
      }> = [];
      for (const purchase of purchases) {
        const alreadyPaid = purchase.payments.reduce(
          (total, payment) => total.add(payment.amount),
          amount(0),
        );
        const outstanding = Prisma.Decimal.max(
          amount(0),
          purchase.totalAmount.sub(alreadyPaid),
        );
        if (outstanding.isZero()) continue;
        const allocation = Prisma.Decimal.min(outstanding, remainingPayment);
        if (allocation.gt(0)) {
          allocations.push({
            purchaseId: purchase.id,
            purchaseNumber: purchase.purchaseNumber,
            amount: allocation,
          });
          remainingPayment = remainingPayment.sub(allocation);
        }
        if (remainingPayment.isZero()) break;
      }
      if (remainingPayment.gt(0))
        throw new ApiError(
          400,
          "Payment exceeds this supplier's total outstanding balance",
        );
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
              method: input.method,
              notes: input.notes,
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
          amount: allocation.amount.toFixed(2),
        })),
        payments: payments.map(paymentSerializer),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
