import { Prisma } from "../../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { calculateInvoice, calculateLine } from "../../shared/money.js";
import { validateQuantity } from "../../shared/quantity.js";

const dec = (n: number | string) => new Prisma.Decimal(n);
function aggregateItems(
  items: Array<{
    productId: string;
    quantity: number;
    discountAmount: number;
    supplierRate?: number;
  }>,
) {
  const map = new Map<string, typeof items>();
  for (const item of items)
    map.set(item.productId, [...(map.get(item.productId) ?? []), item]);
  return map;
}
const totalQuantity = (rows: Array<{ quantity: number }>) =>
  rows.reduce((total, row) => total.add(dec(row.quantity)), dec(0));
const totalDiscount = (rows: Array<{ discountAmount: number }>) =>
  rows.reduce((total, row) => total.add(dec(row.discountAmount)), dec(0));

export async function createSale(input: any) {
  return prisma.$transaction(
    async (tx) => {
      const grouped = aggregateItems(input.items);
      const products = await tx.product.findMany({
        where: { id: { in: [...grouped.keys()] }, active: true },
        include: { unit: true },
      });
      if (products.length !== grouped.size)
        throw new ApiError(400, "One or more products are missing or inactive");
      if (
        input.customerId &&
        !(await tx.customer.findFirst({
          where: { id: input.customerId, active: true },
          select: { id: true },
        }))
      )
        throw new ApiError(400, "Customer is missing or inactive");
      const productById = new Map(products.map((p) => [p.id, p]));
      const lines: any[] = [];
      let subtotal = dec(0);
      let lineDiscounts = dec(0);
      for (const [productId, rows] of grouped) {
        const product = productById.get(productId)!;
        for (const row of rows) validateQuantity(row.quantity, product.unit);
        const quantity = totalQuantity(rows);
        const discount = totalDiscount(rows);
        let calculated;
        try {
          calculated = calculateLine(product.sellingPrice, quantity, discount);
        } catch {
          throw new ApiError(400, "Line discount cannot exceed line value");
        }
        subtotal = subtotal.add(calculated.subtotal);
        lineDiscounts = lineDiscounts.add(calculated.discountAmount);
        lines.push({
          productId,
          quantity,
          unitSellingPrice: product.sellingPrice,
          discountAmount: calculated.discountAmount,
          lineTotal: calculated.total,
          historicalCostSnapshot: product.purchaseRate,
          unitNameSnapshot: product.unit.name,
          unitSymbolSnapshot: product.unit.symbol,
          unitAllowsDecimalsSnapshot: product.unit.allowsDecimals,
        });
      }
      const couponPrice = dec(input.couponPrice ?? 0);
      const invoiceDiscount = dec(input.discountAmount).add(couponPrice);
      let totals;
      try {
        totals = calculateInvoice(subtotal, lineDiscounts, invoiceDiscount);
      } catch {
        throw new ApiError(
          400,
          "Invoice discount cannot exceed the remaining subtotal",
        );
      }
      // Conditional decrement is atomic at the row level and prevents concurrent overselling.
      for (const [productId, rows] of grouped) {
        const quantity = totalQuantity(rows);
        const changed = await tx.product.updateMany({
          where: {
            id: productId,
            active: true,
            currentStock: { gte: quantity },
          },
          data: { currentStock: { decrement: quantity } },
        });
        if (changed.count !== 1)
          throw new ApiError(
            409,
            `Insufficient stock for product ${productById.get(productId)!.name}`,
          );
      }
      return tx.sale.create({
        data: {
          invoiceNumber: `AL-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          customerId: input.customerId ?? null,
          billDate: input.billDate ?? new Date(),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          totalAmount: totals.total,
          status: "POSTED",
          paymentStatus: "UNPAID",
          items: { create: lines },
          ...(input.couponCode
            ? {
                coupon: {
                  create: {
                    code: input.couponCode,
                    price: couponPrice,
                    isSaleBased: true,
                  },
                },
              }
            : {}),
        },
        include: {
          items: { include: { product: { include: { unit: true } } } },
          payments: true,
          coupon: true,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateSaleCoupon(id: string, input: any) {
  return prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { coupon: true, payments: true },
      });
      if (!sale) throw new ApiError(404, "Sale not found");
      if (sale.status !== "POSTED")
        throw new ApiError(409, "Only posted sales can be updated");
      if (sale.payments.length)
        throw new ApiError(409, "A sale with payments cannot be updated");

      const duplicate = await tx.coupon.findUnique({
        where: { code: input.couponCode },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== sale.coupon?.id)
        throw new ApiError(409, "Coupon code has already been recorded");

      const oldCouponPrice = sale.coupon?.price ?? dec(0);
      const newCouponPrice = dec(input.couponPrice);
      const newDiscount = sale.discountAmount
        .sub(oldCouponPrice)
        .add(newCouponPrice);
      if (newDiscount.gt(sale.subtotal))
        throw new ApiError(
          400,
          "Coupon discount cannot exceed the remaining sale value",
        );

      const updatedSale = await tx.sale.update({
        where: { id },
        data: {
          discountAmount: newDiscount,
          totalAmount: sale.subtotal.sub(newDiscount),
        },
      });
      const coupon = sale.coupon
        ? await tx.coupon.update({
            where: { id: sale.coupon.id },
            data: { code: input.couponCode, price: newCouponPrice },
          })
        : await tx.coupon.create({
            data: {
              code: input.couponCode,
              price: newCouponPrice,
              isSaleBased: true,
              saleId: sale.id,
            },
          });
      return { ...updatedSale, coupon };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function createPurchase(input: any) {
  return prisma.$transaction(
    async (tx) => {
      const grouped = aggregateItems(input.items);

      const products = await tx.product.findMany({
        where: { id: { in: [...grouped.keys()] }, active: true },
        include: { unit: true },
      });
      if (products.length !== grouped.size)
        throw new ApiError(400, "One or more products are missing or inactive");
      if (
        !(await tx.supplier.findFirst({
          where: { id: input.supplierId, active: true },
          select: { id: true },
        }))
      )
        throw new ApiError(400, "Supplier is missing or inactive");
      const productById = new Map(products.map((p) => [p.id, p]));
      const lines: any[] = [];
      let subtotal = dec(0);
      for (const [productId, rows] of grouped) {
        const rate = dec(rows[0].supplierRate!);
        const product = productById.get(productId)!;
        for (const row of rows) validateQuantity(row.quantity, product.unit);
        if (rows.some((r) => !dec(r.supplierRate!).eq(rate)))
          throw new ApiError(
            400,
            "Combine duplicate product lines with the same supplier rate",
          );
        const quantity = totalQuantity(rows);
        const calculated = calculateLine(rate, quantity);
        subtotal = subtotal.add(calculated.subtotal);
        lines.push({
          productId,
          quantity,
          supplierRate: rate,
          lineTotal: calculated.total,
          unitNameSnapshot: product.unit.name,
          unitSymbolSnapshot: product.unit.symbol,
          unitAllowsDecimalsSnapshot: product.unit.allowsDecimals,
        });
      }
      const invoiceDiscount = dec(input.discountAmount);
      let totals;
      try {
        totals = calculateInvoice(subtotal, 0, invoiceDiscount);
      } catch {
        throw new ApiError(400, "Purchase discount cannot exceed subtotal");
      }
      for (const [productId, rows] of grouped) {
        const quantity = totalQuantity(rows);
        await tx.product.update({
          where: { id: productId },
          data: {
            currentStock: { increment: quantity },
            purchaseRate: dec(rows[0].supplierRate!),
          },
        });
      }
      return tx.purchase.create({
        data: {
          purchaseNumber: `PUR-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          supplierId: input.supplierId,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          purchaseDate: input.purchaseDate ?? new Date(),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          totalAmount: totals.total,
          status: "POSTED",
          items: { create: lines },
        },
        include: {
          items: { include: { product: { include: { unit: true } } } },
          payments: true,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function cancelSale(id: string) {
  return prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          items: { include: { product: { include: { unit: true } } } },
          payments: true,
        },
      });
      if (!sale) throw new ApiError(404, "Sale not found");
      if (sale.status === "CANCELLED") return sale;
      if (sale.status !== "POSTED")
        throw new ApiError(409, "Only posted sales can be cancelled");
      if (sale.payments.length)
        throw new ApiError(
          409,
          "Sales with recorded payments cannot be cancelled by this API",
        );
      await tx.sale.update({ where: { id }, data: { status: "CANCELLED" } });
      for (const item of sale.items)
        await tx.product.update({
          where: { id: item.productId },
          data: { currentStock: { increment: item.quantity } },
        });
      return { ...sale, status: "CANCELLED" };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function cancelPurchase(id: string) {
  return prisma.$transaction(
    async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id },
        include: {
          items: { include: { product: { include: { unit: true } } } },
          payments: true,
        },
      });
      if (!purchase) throw new ApiError(404, "Purchase not found");
      if (purchase.status === "CANCELLED") return purchase;
      if (purchase.status !== "POSTED")
        throw new ApiError(409, "Only posted purchases can be cancelled");
      if (purchase.payments.length)
        throw new ApiError(
          409,
          "Purchases with recorded payments cannot be cancelled by this API",
        );
      await tx.purchase.update({
        where: { id },
        data: { status: "CANCELLED" },
      });
      for (const item of purchase.items) {
        const changed = await tx.product.updateMany({
          where: { id: item.productId, currentStock: { gte: item.quantity } },
          data: { currentStock: { decrement: item.quantity } },
        });
        if (changed.count !== 1)
          throw new ApiError(
            409,
            "Purchase cannot be cancelled because some purchased stock has already been sold or adjusted",
          );
      }
      return { ...purchase, status: "CANCELLED" };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
