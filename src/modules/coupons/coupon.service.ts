import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { pageMeta } from "../../shared/pagination.js";

const serialize = (coupon: any) => ({
  ...coupon,
  price: coupon.price.toString(),
});

export async function listCoupons(q: any) {
  const where =
    q.type === "sales-based"
      ? { isSaleBased: true }
      : q.type === "non-sale-based"
        ? { isSaleBased: false }
        : {};
  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      include: { sale: { select: { id: true, invoiceNumber: true } } },
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.coupon.count({ where }),
  ]);
  return {
    data: rows.map(serialize),
    meta: pageMeta(q.page, q.limit, total),
  };
}

export async function getCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { sale: { select: { id: true, invoiceNumber: true } } },
  });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  return serialize(coupon);
}

export async function createCoupon(input: any) {
  return serialize(
    await prisma.coupon.create({
      data: { code: input.code, price: input.price, isSaleBased: false },
    }),
  );
}

export async function updateCoupon(id: string, input: any) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  if (coupon.isSaleBased)
    throw new ApiError(409, "Sale-based coupons must be changed through the sale");
  return serialize(await prisma.coupon.update({ where: { id }, data: input }));
}

export async function deleteCoupon(id: string) {
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");
  if (coupon.isSaleBased)
    throw new ApiError(409, "Sale-based coupons cannot be deleted");
  await prisma.coupon.delete({ where: { id } });
}
