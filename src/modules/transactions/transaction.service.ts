import { Prisma } from "../../../generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { calculateInvoice, calculateLine } from "../../shared/money.js";
import { validateQuantity } from "../../shared/quantity.js";

const dec = (n: Prisma.Decimal | number | string) => new Prisma.Decimal(n);
const invoiceDateKey = (date: Date) =>
  `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;

function aggregateItems(
  items: Array<{
    productId: string;
    quantity: number;
    discountAmount: number;
    unitSellingPrice?: number;
    supplierRate?: number;
    displayQuantity?: number;
    displayUnitName?: string;
    displayUnitSymbol?: string;
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

export async function createSale(input: any, attempt = 0) {
  try {
    return await prisma.$transaction(
    async (tx) => {
      const billDate = input.billDate ?? new Date();
      const dateKey = invoiceDateKey(billDate);
      const invoiceCounter = await tx.saleInvoiceCounter.upsert({
        where: { dateKey },
        create: { dateKey, lastSequence: 1 },
        update: { lastSequence: { increment: 1 } },
        select: { lastSequence: true },
      });
      const invoiceNumber = `AL-${dateKey}-${String(invoiceCounter.lastSequence).padStart(3, "0")}`;
      const productIds = [...new Set<string>(input.items.map((item: any) => item.productId))];
      const batchIds = [...new Set<string>(input.items.map((item: any) => item.inventoryBatchId))];
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, active: true },
        include: { unit: true },
      });
      if (products.length !== productIds.length)
        throw new ApiError(400, "One or more products are missing or inactive");
      const batches = await tx.inventoryBatch.findMany({ where: {
        id: { in: batchIds }, status: "ACTIVE", remainingQuantity: { gt: 0 },
      } });
      if (batches.length !== batchIds.length)
        throw new ApiError(409, "One or more selected stock batches are unavailable");
      if (
        input.customerId &&
        !(await tx.customer.findFirst({
          where: { id: input.customerId, active: true },
          select: { id: true },
        }))
      )
        throw new ApiError(400, "Customer is missing or inactive");
      const productById = new Map<string, (typeof products)[number]>(products.map((p) => [p.id, p]));
      const batchById = new Map<string, (typeof batches)[number]>(batches.map((batch) => [batch.id, batch]));
      const lines: any[] = [];
      const quantityByProduct = new Map<string, Prisma.Decimal>();
      const quantityByBatch = new Map<string, Prisma.Decimal>();
      let subtotal = dec(0);
      let lineDiscounts = dec(0);
      for (const row of input.items) {
        const product = productById.get(row.productId)!;
        const batch = batchById.get(row.inventoryBatchId)!;
        if (batch.productId !== product.id)
          throw new ApiError(400, "Selected batch does not belong to the selected product");
        validateQuantity(row.quantity, product.unit);
        if (row.displayQuantity !== undefined) {
          const isKilogram = product.unit.name.trim().toLowerCase() === "kilogram" || product.unit.symbol?.trim().toLowerCase() === "kg";
          if (!isKilogram || row.displayUnitName !== "Gram" || row.displayUnitSymbol !== "g" || !dec(row.displayQuantity).div(1000).eq(dec(row.quantity)))
            throw new ApiError(400, "Gram quantity must match the product quantity in kilograms");
        }
        const quantity = dec(row.quantity);
        const priorBatchQuantity = quantityByBatch.get(batch.id) ?? dec(0);
        const nextBatchQuantity = priorBatchQuantity.add(quantity);
        if (nextBatchQuantity.gt(batch.remainingQuantity))
          throw new ApiError(409, `Insufficient stock in selected batch for ${product.name}`);
        quantityByBatch.set(batch.id, nextBatchQuantity);
        quantityByProduct.set(product.id, (quantityByProduct.get(product.id) ?? dec(0)).add(quantity));
        const rate = dec(row.unitSellingPrice ?? batch.sellingRate);
        let calculated;
        try { calculated = calculateLine(rate, quantity, dec(row.discountAmount)); }
        catch { throw new ApiError(400, "Line discount cannot exceed line value"); }
        subtotal = subtotal.add(calculated.subtotal);
        lineDiscounts = lineDiscounts.add(calculated.discountAmount);
        lines.push({
          productId: product.id,
          inventoryBatchId: batch.id,
          quantity,
          unitSellingPrice: rate,
          batchSellingPriceSnapshot: batch.sellingRate,
          historicalCostSnapshot: batch.purchaseRate,
          costSnapshotSource: "VERIFIED_BATCH",
          discountAmount: calculated.discountAmount,
          lineTotal: calculated.total,
          unitNameSnapshot: product.unit.name,
          unitSymbolSnapshot: product.unit.symbol,
          unitAllowsDecimalsSnapshot: product.unit.allowsDecimals,
          ...(row.displayQuantity !== undefined ? {
            displayQuantity: dec(row.displayQuantity),
            displayUnitNameSnapshot: "Gram",
            displayUnitSymbolSnapshot: "g",
          } : {}),
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
      for (const [batchId, quantity] of quantityByBatch) {
        const batch = batchById.get(batchId)!;
        const changed = await tx.inventoryBatch.updateMany({
          where: { id: batchId, status: "ACTIVE", remainingQuantity: { gte: quantity } },
          data: {
            remainingQuantity: { decrement: quantity },
            ...(batch.remainingQuantity.eq(quantity) ? { status: "DEPLETED" } : {}),
          },
        });
        if (changed.count !== 1)
          throw new ApiError(409, "Selected stock batch no longer has enough quantity");
      }
      for (const [productId, quantity] of quantityByProduct) {
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
      const sale = await tx.sale.create({
        data: {
          invoiceNumber,
          customerId: input.customerId ?? null,
          billDate,
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
      if (input.creditBill) {
        if (!sale.customerId)
          throw new ApiError(400, "A customer is required for a credit bill");
        await tx.customerCreditBill.create({
          data: {
            customerId: sale.customerId,
            saleId: sale.id,
            billNumber: input.creditBill.billNumber,
            billDate: sale.billDate,
            dueDate: input.creditBill.dueDate,
            term: input.creditBill.term,
            billAmount: sale.totalAmount,
            priorBalance: input.creditBill.priorBalance ?? dec(0),
          },
        });
      }
      return sale;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );
  } catch (error) {
    const isSerializationConflict =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    if (isSerializationConflict && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      return createSale(input, attempt + 1);
    }
    throw error;
  }
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
  try {
    return await prisma.$transaction(
      async (tx) => {
        const duplicate = await tx.purchase.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          include: { items: { include: { product: { include: { unit: true } }, inventoryBatch: true } }, payments: true },
        });
        if (duplicate) return duplicate;

        const productIds: string[] = [...new Set<string>(input.items.map((item: any) => item.productId))];
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, active: true }, include: { unit: true },
        });
        if (products.length !== productIds.length)
          throw new ApiError(400, "One or more products are missing or inactive");
        if (!(await tx.supplier.findFirst({ where: { id: input.supplierId, active: true }, select: { id: true } })))
          throw new ApiError(400, "Supplier is missing or inactive");
        const productById = new Map<string, (typeof products)[number]>(products.map((p) => [p.id, p]));
        let subtotal = dec(0);
        const purchaseLines = input.items.map((row: any) => {
          const product = productById.get(row.productId)!;
          validateQuantity(row.quantity, product.unit);
          const rate = dec(row.supplierRate);
          const sellingRate = dec(row.sellingRate);
          const quantity = dec(row.quantity);
          const line = calculateLine(rate, quantity);
          subtotal = subtotal.add(line.subtotal);
          return { product, row, rate, sellingRate, quantity, line };
        });
        let totals;
        try {
          totals = calculateInvoice(subtotal, 0, dec(input.discountAmount));
        } catch {
          throw new ApiError(400, "Purchase discount cannot exceed subtotal");
        }
        const purchase = await tx.purchase.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          purchaseNumber: `PUR-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
          supplierId: input.supplierId,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          purchaseDate: input.purchaseDate ?? new Date(),
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          totalAmount: totals.total,
          status: "POSTED",
        },
        include: { payments: true },
      });
      for (const { product, row, rate, sellingRate, quantity, line } of purchaseLines) {
        const purchaseItem = await tx.purchaseItem.create({ data: {
          purchaseId: purchase.id, productId: product.id, quantity,
          supplierRate: rate, lineTotal: line.total,
          unitNameSnapshot: product.unit.name, unitSymbolSnapshot: product.unit.symbol,
          unitAllowsDecimalsSnapshot: product.unit.allowsDecimals,
        } });
        await tx.inventoryBatch.create({ data: {
          productId: product.id, purchaseItemId: purchaseItem.id,
          label: null,
          receivedQuantity: quantity, remainingQuantity: quantity,
          purchaseRate: rate, sellingRate,
          receivedAt: input.purchaseDate ?? new Date(), source: "PURCHASE", status: "ACTIVE",
        } });
        await tx.product.update({ where: { id: product.id }, data: {
          currentStock: { increment: quantity }, purchaseRate: rate, sellingPrice: sellingRate,
        } });
      }
      return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: {
        items: { include: { product: { include: { unit: true } }, inventoryBatch: true } }, payments: true,
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.purchase.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: {
        items: { include: { product: { include: { unit: true } }, inventoryBatch: true } }, payments: true,
      } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

export async function cancelSale(id: string) {
  return prisma.$transaction(
    async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          items: { include: { product: { include: { unit: true } }, inventoryBatch: true } },
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
      const quantitiesByBatch = new Map<string, Prisma.Decimal>();
      const batches = new Map<string, (typeof sale.items)[number]["inventoryBatch"]>();
      const quantitiesByProduct = new Map<string, Prisma.Decimal>();
      for (const item of sale.items) {
        const batch = item.inventoryBatch;
        if (!item.inventoryBatchId || !batch || batch.productId !== item.productId)
          throw new ApiError(
            409,
            "This sale has no reliable stock batch reference and cannot be safely cancelled",
          );
        if (batch.status === "CANCELLED")
          throw new ApiError(409, "The stock batch for this sale is no longer available");
        quantitiesByBatch.set(
          batch.id,
          (quantitiesByBatch.get(batch.id) ?? dec(0)).add(item.quantity),
        );
        batches.set(batch.id, batch);
        quantitiesByProduct.set(
          item.productId,
          (quantitiesByProduct.get(item.productId) ?? dec(0)).add(item.quantity),
        );
      }
      const changedSale = await tx.sale.updateMany({
        where: { id, status: "POSTED" },
        data: { status: "CANCELLED" },
      });
      if (changedSale.count !== 1)
        throw new ApiError(409, "Sale status changed while cancellation was being processed");
      for (const [batchId, quantity] of quantitiesByBatch) {
        const batch = batches.get(batchId)!;
        if (batch.remainingQuantity.add(quantity).gt(batch.receivedQuantity))
          throw new ApiError(409, "Sale quantity cannot be restored to its original stock batch");
        const changed = await tx.inventoryBatch.updateMany({
          where: {
            id: batchId,
            status: batch.status,
            remainingQuantity: batch.remainingQuantity,
          },
          data: {
            remainingQuantity: { increment: quantity },
            status: "ACTIVE",
          },
        });
        if (changed.count !== 1)
          throw new ApiError(409, "Stock batch changed during sale cancellation; retry the request");
      }
      for (const [productId, quantity] of quantitiesByProduct) {
        const changed = await tx.product.updateMany({
          where: { id: productId },
          data: { currentStock: { increment: quantity } },
        });
        if (changed.count !== 1)
          throw new ApiError(409, "Product stock could not be restored for this sale");
      }
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
          items: { include: { product: { include: { unit: true } }, inventoryBatch: true } },
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
      for (const item of purchase.items) {
        const batch = item.inventoryBatch;
        if (
          !batch ||
          batch.productId !== item.productId ||
          batch.purchaseItemId !== item.id ||
          batch.source !== "PURCHASE" ||
          batch.status !== "ACTIVE" ||
          !batch.remainingQuantity.eq(batch.receivedQuantity)
        )
          throw new ApiError(
            409,
            "Purchase cannot be cancelled because its stock batch has been sold or adjusted",
          );
      }
      const changedPurchase = await tx.purchase.updateMany({
        where: { id, status: "POSTED" },
        data: { status: "CANCELLED" },
      });
      if (changedPurchase.count !== 1)
        throw new ApiError(409, "Purchase status changed while cancellation was being processed");
      for (const item of purchase.items) {
        const batch = item.inventoryBatch!;
        const changedBatch = await tx.inventoryBatch.updateMany({
          where: {
            id: batch.id,
            status: "ACTIVE",
            remainingQuantity: batch.receivedQuantity,
          },
          data: {
            remainingQuantity: 0,
            status: "CANCELLED",
          },
        });
        if (changedBatch.count !== 1)
          throw new ApiError(409, "Purchase batch changed during cancellation; retry the request");
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
