import { Prisma } from "../../../generated/prisma/client.js";
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
      if (input.method === "COUPON") {
        const couponCode = /^Coupon code: (.+)$/.exec(input.notes ?? "")?.[1];
        if (!couponCode)
          throw new ApiError(400, "A coupon code is required for coupon payments");
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
      }
      const payment = await paymentModel.createCustomerPayment(
        {
          ...input,
          customerId: sale.customerId,
          paymentDate: input.paymentDate ?? new Date(),
          amount: paymentAmount,
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
      const purchase = await paymentModel.purchase(input.purchaseId, tx);
      if (!purchase || purchase.status !== "POSTED")
        throw new ApiError(404, "Posted purchase not found");
      if (purchase.supplierId !== input.supplierId)
        throw new ApiError(
          400,
          "Payment supplier must match the purchase supplier",
        );
      const payments = await paymentModel.purchasePayments(purchase.id, tx);
      const outstanding = purchase.totalAmount.sub(
        payments._sum.amount ?? amount(0),
      );
      const paymentAmount = amount(input.amount);
      if (paymentAmount.gt(outstanding))
        throw new ApiError(
          400,
          "Payment exceeds the purchase outstanding amount",
        );
      const payment = await paymentModel.createSupplierPayment(
        {
          ...input,
          paymentDate: input.paymentDate ?? new Date(),
          amount: paymentAmount,
        },
        tx,
      );
      return paymentSerializer(payment);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
