import { Prisma } from "../../../generated/prisma/client.js";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { pageMeta } from "../../shared/pagination.js";

const couponNotePrefix = "Coupon code: ";
const redemptionWhere = {
  method: "COUPON" as const,
  notes: { startsWith: couponNotePrefix },
};

const serializeRedemption = (payment: any) => ({
  id: payment.id,
  code: payment.notes.slice(couponNotePrefix.length),
  amount: payment.amount.toString(),
  paymentDate: payment.paymentDate,
  saleId: payment.saleId,
  isSaleBased: Boolean(payment.saleId),
  billNumber: payment.sale?.invoiceNumber ?? "—",
  customerName: payment.customer?.name ?? payment.sale?.customer?.name ?? "Walk-in customer",
});

const serializeCoupon = (coupon: any, payments: any[]) => {
  const redemptions = payments
    .filter((payment) => payment.notes === `${couponNotePrefix}${coupon.code}`)
    .map(serializeRedemption);
  const redeemedAmount = redemptions.reduce(
    (total, redemption) => total.add(new Prisma.Decimal(redemption.amount)),
    new Prisma.Decimal(0),
  );
  return {
    ...coupon,
    price: coupon.price.toString(),
    redeemedAmount: redeemedAmount.toFixed(2),
    remainingAmount: coupon.isSaleBased
      ? null
      : Prisma.Decimal.max(new Prisma.Decimal(0), coupon.price.sub(redeemedAmount)).toFixed(2),
    redemptions,
  };
};

async function getCouponPaymentRows() {
  return prisma.customerPayment.findMany({
    where: redemptionWhere,
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      notes: true,
      saleId: true,
      customer: { select: { name: true } },
      sale: { select: { invoiceNumber: true, customer: { select: { name: true } } } },
    },
    orderBy: { paymentDate: "desc" },
  });
}

export async function listCoupons(q: any) {
  const where =
    q.type === "sales-based"
      ? { isSaleBased: true }
      : q.type === "non-sale-based"
        ? { isSaleBased: false }
        : {};
  const [rows, total, payments] = await Promise.all([
    prisma.coupon.findMany({
      where,
      include: { sale: { select: { id: true, invoiceNumber: true } } },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.coupon.count({ where }),
    getCouponPaymentRows(),
  ]);
  return {
    data: rows.map((coupon) => serializeCoupon(coupon, payments)),
    meta: pageMeta(q.page, q.limit, total),
  };
}

export async function listCouponRedemptions() {
  return (await getCouponPaymentRows()).map(serializeRedemption);
}

export async function getCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { sale: { select: { id: true, invoiceNumber: true } } },
  });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  return serializeCoupon(coupon, await getCouponPaymentRows());
}

export async function createCoupon(input: any) {
  return serializeCoupon(
    await prisma.coupon.create({
      data: { code: input.code, price: input.price, isSaleBased: false },
    }),
    [],
  );
}

export async function updateCoupon(id: string, input: any) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  if (coupon.isSaleBased)
    throw new ApiError(409, "Sale-based coupons must be changed through the sale");
  const redeemed = await prisma.customerPayment.aggregate({
    where: { ...redemptionWhere, notes: `${couponNotePrefix}${coupon.code}` },
    _sum: { amount: true },
  });
  const redeemedAmount = redeemed._sum.amount ?? new Prisma.Decimal(0);
  if (redeemedAmount.gt(0) && input.code && input.code !== coupon.code)
    throw new ApiError(409, "A coupon code cannot be changed after it has been used");
  if (input.price !== undefined && new Prisma.Decimal(input.price).lt(redeemedAmount))
    throw new ApiError(409, "Coupon value cannot be lower than the amount already redeemed");
  const updated = await prisma.coupon.update({ where: { id }, data: input });
  return serializeCoupon(updated, await getCouponPaymentRows());
}

export async function deleteCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  if (coupon.isSaleBased)
    throw new ApiError(409, "Sale-based coupons cannot be deleted");
  const redeemed = await prisma.customerPayment.count({
    where: { ...redemptionWhere, notes: `${couponNotePrefix}${coupon.code}` },
  });
  if (redeemed > 0)
    throw new ApiError(409, "A coupon with redemption history cannot be deleted");
  await prisma.coupon.delete({ where: { id } });
}
