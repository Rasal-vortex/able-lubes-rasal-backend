import { Prisma } from "../../../generated/prisma/client.js";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { calculateInvoice, calculateLine } from "../../shared/money.js";
import { validateQuantity } from "../../shared/quantity.js";
import { purchaseCancellationBlockers } from "../purchases/purchase-eligibility.js";
import { applySupplierCredits } from "../payments/supplier-credit.service.js";

const dec = (n: Prisma.Decimal | number | string) => new Prisma.Decimal(n);
type SaleCancellationInput = {
  reason: string;
  refundMode: "PENDING" | "NOW";
  actualReceivedConfirmed?: boolean;
  refunds?: Array<{ amount: number | string; method: "CASH" | "UPI" | "BANK" | "OTHER"; reference?: string; originalPaymentId?: string }>;
  actualPayments?: Array<{ amount: number | string; method: "CASH" | "UPI" | "BANK" | "OTHER" }>;
};
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
  if (!Array.isArray(input.paymentAllocations))
    throw new ApiError(400, "Payment allocations are required to create a sale");
  const requestHash = createHash("sha256").update(JSON.stringify({ ...input, idempotencyKey: undefined })).digest("hex");
  try {
    return await prisma.$transaction(
    async (tx) => {
      const priorSale = await tx.sale.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: { include: { product: { include: { unit: true } } } }, payments: true, coupon: true } });
      if (priorSale) {
        if (priorSale.requestHash !== requestHash) throw new ApiError(409, "This idempotency key was already used for a different sale");
        return priorSale;
      }
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
      const allocations = input.paymentAllocations as Array<{ method: "CASH" | "UPI" | "COUPON" | "STORE_CREDIT" | "CREDIT"; amount: number | string; notes?: string }>;
      let allocationTotal = dec(0);
      let creditAmount = dec(0);
      for (const allocation of allocations) {
        const value = dec(allocation.amount);
        if (value.isNegative() || !value.eq(value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)))
          throw new ApiError(400, "Payment amounts must be non-negative and support up to two decimal places");
        allocationTotal = allocationTotal.add(value);
        if (allocation.method === "CREDIT") creditAmount = creditAmount.add(value);
      }
      if (!allocationTotal.eq(totals.total))
        throw new ApiError(400, allocationTotal.lt(totals.total) ? "Payment allocations are less than the final bill total" : "Payment allocations exceed the final bill total");
      if (creditAmount.gt(0) && (!input.customerId || !input.creditBill))
        throw new ApiError(400, "A registered customer and credit bill details are required for credit allocations");
      if (creditAmount.isZero() && input.creditBill)
        throw new ApiError(400, "A credit bill cannot be created without a Credit allocation");
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
          idempotencyKey: input.idempotencyKey,
          requestHash,
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
      for (const allocation of allocations) {
        if (allocation.method === "CREDIT" || dec(allocation.amount).isZero()) continue;
        const value = dec(allocation.amount);
        let notes = allocation.notes;
        if (allocation.method === "STORE_CREDIT") {
          if (!sale.customerId) throw new ApiError(400, "Store Credit requires a registered customer");
          const balances = await tx.customerStoreCreditTransaction.groupBy({ by: ["type"], where: { customerId: sale.customerId }, _sum: { amount: true } });
          const available = balances.reduce((balance, row) => balance.add(row.type === "CREDIT" ? row._sum.amount ?? dec(0) : (row._sum.amount ?? dec(0)).neg()), dec(0));
          if (value.gt(available)) throw new ApiError(400, "Store Credit exceeds the customer's available balance");
        }
        if (allocation.method === "COUPON") {
          const code = /^Coupon code: (.+)$/.exec(notes ?? "")?.[1];
          if (code) {
            if (await tx.coupon.findUnique({ where: { code }, select: { id: true } })) throw new ApiError(409, "Use an unrecorded coupon code for a split sale payment");
            if (await tx.customerPayment.findFirst({ where: { method: "COUPON", notes: `Coupon code: ${code}` }, select: { id: true } })) throw new ApiError(409, "This coupon code has already been used");
          } else notes = "Coupon payment (no code)";
        }
        const payment = await tx.customerPayment.create({ data: { customerId: sale.customerId, saleId: sale.id, amount: value, method: allocation.method, paymentDate: billDate, notes } });
        if (allocation.method === "STORE_CREDIT") await tx.customerStoreCreditTransaction.create({ data: { customerId: sale.customerId!, type: "DEBIT", amount: value, saleId: sale.id, paymentId: payment.id } });
      }
      const paidAmount = allocations.filter((allocation) => allocation.method !== "CREDIT").reduce((total, allocation) => total.add(dec(allocation.amount)), dec(0));
      await tx.sale.update({ where: { id: sale.id }, data: { paymentStatus: paidAmount.eq(totals.total) ? "PAID" : paidAmount.isZero() ? "UNPAID" : "PARTIALLY_PAID" } });
      return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: { include: { product: { include: { unit: true } } } }, payments: true, coupon: true } });
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.sale.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { items: { include: { product: { include: { unit: true } } } }, payments: true, coupon: true } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, "This idempotency key was already used for a different sale");
        return existing;
      }
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
          include: { items: { include: { product: { include: { unit: true } }, inventoryBatch: true } }, payments: true, supplierCreditApplications: { include: { reversals: true } } },
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
          currentStock: { increment: quantity }, purchaseRate: rate,
        } });
      }
      await applySupplierCredits(tx, purchase.supplierId);
      return tx.purchase.findUniqueOrThrow({ where: { id: purchase.id }, include: {
        items: { include: { product: { include: { unit: true } }, inventoryBatch: true } }, payments: true,
        supplierCreditApplications: { include: { reversals: true } },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const duplicate = await prisma.purchase.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: {
        items: { include: { product: { include: { unit: true } }, inventoryBatch: true } }, payments: true, supplierCreditApplications: { include: { reversals: true } },
      } });
      if (duplicate) return duplicate;
    }
    throw error;
  }
}

async function cancelSaleWithinTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  input: SaleCancellationInput,
  userId?: string,
) {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          items: { include: { product: { include: { unit: true } }, inventoryBatch: true } },
          payments: true,
          cancellation: { include: { refunds: true } },
          returns: { select: { id: true } },
        },
      });
      if (!sale) throw new ApiError(404, "Sale not found");
      if (sale.status === "CANCELLED") {
        if (sale.cancellation) return sale;
        throw new ApiError(409, "This sale was already cancelled and has no cancellation audit record");
      }
      if (sale.status !== "POSTED")
        throw new ApiError(409, "Only posted sales can be cancelled");
      if (sale.returns.length)
        throw new ApiError(409, "A sale with recorded returns cannot be cancelled; return its remaining products through Sales Return");
      const reason = input.reason.trim();
      if (!reason) throw new ApiError(400, "Cancellation reason is required");
      const recordedCollected = sale.payments
        .filter((payment) => payment.method === "CASH" || payment.method === "UPI")
        .reduce((total, payment) => total.add(payment.amount), dec(0));
      const actualPayments = input.actualPayments ?? sale.payments
        .filter((payment) => payment.method === "CASH" || payment.method === "UPI")
        .map((payment) => ({ amount: payment.amount, method: payment.method as "CASH" | "UPI" }));
      const storeCreditPayments = sale.payments.filter((payment) => payment.method === "STORE_CREDIT");
      const storeCreditDebits = storeCreditPayments.length
        ? await tx.customerStoreCreditTransaction.findMany({
            where: { paymentId: { in: storeCreditPayments.map((payment) => payment.id) } },
          })
        : [];
      if (storeCreditPayments.length) {
        if (!sale.customerId)
          throw new ApiError(409, "Store credit on this sale has no customer to restore it to");
        for (const payment of storeCreditPayments) {
          const debit = storeCreditDebits.find((entry) => entry.paymentId === payment.id);
          if (!debit || debit.type !== "DEBIT" || debit.customerId !== sale.customerId || debit.saleId !== sale.id || !dec(debit.amount).eq(payment.amount))
            throw new ApiError(409, "Store credit history for this sale is incomplete; cancellation was stopped to protect the customer balance");
        }
      }
      const actualByMethod = new Map<string, Prisma.Decimal>();
      for (const payment of actualPayments) {
        const amount = dec(payment.amount);
        if (amount.lt(0)) throw new ApiError(400, "Actual payment amounts cannot be negative");
        actualByMethod.set(payment.method, (actualByMethod.get(payment.method) ?? dec(0)).add(amount));
      }
      const actualTotal = [...actualByMethod.values()].reduce((total, amount) => total.add(amount), dec(0));
      if (actualTotal.gt(recordedCollected) || actualTotal.gt(sale.totalAmount))
        throw new ApiError(400, "Actual received amount cannot exceed the recorded collection or sale total");
      const refunds = input.refunds ?? [];
      if (input.refundMode === "PENDING" && refunds.length)
        throw new ApiError(400, "Pending refund mode cannot record an actual refund");
      if (input.refundMode === "NOW" && actualTotal.gt(0) && !refunds.length)
        throw new ApiError(400, "Enter an actual refund amount or choose pending");
      const refundTotal = refunds.reduce((total, refund) => total.add(dec(refund.amount)), dec(0));
      if (refundTotal.gt(actualTotal)) throw new ApiError(400, "Refund total cannot exceed the amount actually received");
      const originalPayments = new Map(sale.payments.map((payment) => [payment.id, payment]));
      const retainedByPayment = new Map<string, Prisma.Decimal>();
      const corrections: Array<{
        cancellationId?: string;
        originalPaymentId?: string;
        type: "REVERSAL" | "ACTUAL_RECEIPT";
        amount: Prisma.Decimal;
        method: "CASH" | "UPI" | "BANK" | "OTHER";
        reason: string;
        createdById?: string;
      }> = [];
      for (const payment of sale.payments) {
        if (payment.method !== "CASH" && payment.method !== "UPI") continue;
        const method = payment.method as "CASH" | "UPI";
        const remainingActual = actualByMethod.get(method) ?? dec(0);
        const retained = Prisma.Decimal.min(payment.amount, remainingActual);
        retainedByPayment.set(payment.id, retained);
        actualByMethod.set(method, remainingActual.sub(retained));
        const reversed = payment.amount.sub(retained);
        if (reversed.gt(0)) corrections.push({
          originalPaymentId: payment.id, type: "REVERSAL", amount: reversed,
          method, reason, createdById: userId,
        });
      }
      for (const [method, amount] of actualByMethod) {
        if (amount.gt(0)) corrections.push({
          type: "ACTUAL_RECEIPT", amount,
          method: method as "CASH" | "UPI" | "BANK" | "OTHER", reason, createdById: userId,
        });
      }
      const refundsByPayment = new Map<string, Prisma.Decimal>();
      for (const refund of refunds) {
        if (!refund.originalPaymentId) continue;
        const originalPayment = originalPayments.get(refund.originalPaymentId);
        if (!originalPayment) throw new ApiError(400, "Refund reference must belong to a payment on this sale");
        const refundedForPayment = (refundsByPayment.get(originalPayment.id) ?? dec(0)).add(dec(refund.amount));
        if (refundedForPayment.gt(retainedByPayment.get(originalPayment.id) ?? dec(0)))
          throw new ApiError(400, "Refunds linked to a payment cannot exceed the verified amount received from it");
        refundsByPayment.set(originalPayment.id, refundedForPayment);
      }
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

      const cancellation = await tx.saleCancellation.create({
        data: {
          saleId: sale.id,
          reason,
          cancelledById: userId,
          collectedAmount: actualTotal,
          actualReceivedAmount: actualTotal,
          pendingAmount: actualTotal.sub(refundTotal),
          paymentCorrections: corrections.length ? { create: corrections } : undefined,
          refunds: refunds.length ? { create: refunds.map((refund) => ({
            amount: dec(refund.amount), method: refund.method, reference: refund.reference?.trim() || null,
            originalPaymentId: refund.originalPaymentId, createdById: userId,
          })) } : undefined,
        },
      });
      if (storeCreditPayments.length) {
        await Promise.all(storeCreditDebits.map((debit) => tx.customerStoreCreditTransaction.create({
          data: {
            customerId: debit.customerId,
            type: "CREDIT",
            amount: debit.amount,
            saleId: sale.id,
            cancellationId: cancellation.id,
            reversalOfTransactionId: debit.id,
          },
        })));
      }
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
        const product = await tx.product.update({
          where: { id: productId },
          data: { currentStock: { increment: quantity } },
          select: { currentStock: true },
        });
        const productBatchIds = [...quantitiesByBatch.entries()]
          .filter(([batchId]) => batches.get(batchId)?.productId === productId);
        for (const [batchId, restoredQuantity] of productBatchIds) {
          await tx.stockMovement.create({ data: {
            productId,
            inventoryBatchId: batchId,
            type: "ADJUSTMENT",
            direction: "IN",
            quantity: restoredQuantity,
            stockAfter: product.currentStock,
            reason: `Sale cancellation ${sale.invoiceNumber}`,
            notes: reason,
            createdById: userId,
          } });
        }
      }
      return { ...sale, status: "CANCELLED", cancellation: { ...cancellation, refunds } };
}

export async function cancelSale(
  id: string,
  input: SaleCancellationInput = { reason: "Sale cancelled", refundMode: "PENDING" },
  userId?: string,
) {
  return prisma.$transaction(
    (tx) => cancelSaleWithinTransaction(tx, id, input, userId),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function cancelCreditBillSale(
  creditBillId: string,
  input: SaleCancellationInput,
  userId?: string,
) {
  if (!input.actualPayments?.length || input.actualReceivedConfirmed !== true)
    throw new ApiError(400, "Confirm the amount actually received before cancelling this credit sale");
  return prisma.$transaction(async (tx) => {
    const bill = await tx.customerCreditBill.findUnique({ where: { id: creditBillId }, select: { id: true, saleId: true } });
    if (!bill) throw new ApiError(404, "Credit bill not found");
    if (!bill.saleId) throw new ApiError(409, "Only Billing-generated credit bills can be cancelled as sales");
    return cancelSaleWithinTransaction(tx, bill.saleId, input, userId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function settleCreditBillRefund(
  creditBillId: string,
  input: { amount: number | string; method: "CASH" | "UPI" | "BANK" | "OTHER"; reference?: string; idempotencyKey: string; originalPaymentId?: string },
  userId?: string,
) {
  try { return await prisma.$transaction(async (tx) => {
    const bill = await tx.customerCreditBill.findUnique({ where: { id: creditBillId }, select: { saleId: true } });
    if (!bill?.saleId) throw new ApiError(404, "Cancelled sales credit bill not found");
    const priorRefund = await tx.saleRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
    if (priorRefund) return { id: bill.saleId, duplicate: true };
    const cancellation = await tx.saleCancellation.findUnique({ where: { saleId: bill.saleId } });
    if (!cancellation) throw new ApiError(409, "This sale has no pending refund record");
    const amount = dec(input.amount);
    if (amount.lte(0) || amount.gt(cancellation.pendingAmount))
      throw new ApiError(400, "Refund settlement must be positive and cannot exceed the pending refund");
    if (input.originalPaymentId) {
      const originalPayment = await tx.customerPayment.findFirst({ where: { id: input.originalPaymentId, saleId: bill.saleId } });
      if (!originalPayment) throw new ApiError(400, "Refund reference must belong to a payment on this sale");
      const reversals = await tx.salePaymentCorrection.aggregate({
        where: { cancellationId: cancellation.id, originalPaymentId: originalPayment.id, type: "REVERSAL" },
        _sum: { amount: true },
      });
      const priorRefunds = await tx.saleRefund.aggregate({
        where: { cancellationId: cancellation.id, originalPaymentId: originalPayment.id },
        _sum: { amount: true },
      });
      const verifiedFromPayment = originalPayment.amount.sub(reversals._sum.amount ?? dec(0));
      if ((priorRefunds._sum.amount ?? dec(0)).add(amount).gt(verifiedFromPayment))
        throw new ApiError(400, "Refunds linked to a payment cannot exceed the verified amount received from it");
    }
    const updated = await tx.saleCancellation.updateMany({
      where: { id: cancellation.id, pendingAmount: { gte: amount } },
      data: { pendingAmount: { decrement: amount } },
    });
    if (updated.count !== 1) throw new ApiError(409, "Pending refund changed; refresh and try again");
    await tx.saleRefund.create({ data: {
      cancellationId: cancellation.id, amount, method: input.method,
      reference: input.reference?.trim() || null, createdById: userId, idempotencyKey: input.idempotencyKey,
      originalPaymentId: input.originalPaymentId,
    } });
    return { id: bill.saleId, pendingAmount: cancellation.pendingAmount.sub(amount).toFixed(2) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const priorRefund = await prisma.saleRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
      if (priorRefund) return { duplicate: true };
    }
    throw error;
  }
}

export async function cancelPurchase(id: string, input: any = { idempotencyKey: randomUUID(), reason: "Purchase cancelled", paymentGroupDecisions: [], refundNow: [], refundPending: [] }, userId?: string) {
  return prisma.$transaction(
    async (tx) => {
      const priorCancellation = await tx.purchaseCancellation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { supplierRefund: { include: { settlements: { include: { lines: true } } } }, supplierCredits: { include: { applications: true } }, supplierCreditApplicationReversals: true },
      });
      if (priorCancellation) {
        const priorPurchase = await tx.purchase.findUniqueOrThrow({ where: { id: priorCancellation.purchaseId } });
        return { ...priorPurchase, status: "CANCELLED", cancellation: priorCancellation };
      }
      const purchase = await tx.purchase.findUnique({
        where: { id },
        include: {
          items: { include: { product: { include: { unit: true } }, inventoryBatch: { include: { saleItems: { select: { id: true } }, stockMovements: { select: { id: true } } } } } },
          payments: { include: { reversals: true, transferDecisions: true } },
          supplierCreditApplications: { where: { reversals: { none: {} } } },
          cancellation: true,
        },
      });
      if (!purchase) throw new ApiError(404, "Purchase not found");
      if (purchase.status === "CANCELLED")
        throw new ApiError(409, "This purchase has already been cancelled");
      if (purchase.status !== "POSTED")
        throw new ApiError(409, "Only posted purchases can be cancelled");
      const blockers = purchaseCancellationBlockers(purchase);
      if (blockers.length)
        throw new ApiError(409, `Cannot cancel purchase: ${blockers.map((entry: any) => `${entry.productName} ${entry.reason}`).join(" ")}`);

      const reason = String(input.reason ?? "").trim();
      if (!reason) throw new ApiError(400, "Cancellation reason is required");
      const paymentGroups = new Map<string, { key: string; paymentGroupId: string | null; paymentIds: string[]; targetPayments: typeof purchase.payments }>();
      for (const payment of purchase.payments) {
        const key = payment.paymentGroupId ? `group:${payment.paymentGroupId}` : `payment:${payment.id}`;
        const group = paymentGroups.get(key) ?? { key, paymentGroupId: payment.paymentGroupId, paymentIds: [], targetPayments: [] };
        group.paymentIds.push(payment.id);
        group.targetPayments.push(payment);
        paymentGroups.set(key, group);
      }
      const decisionsInput = (input.paymentGroupDecisions ?? []) as Array<{ paymentGroupId?: string | null; paymentId?: string; wasTransferred: boolean }>;
      const decisionByKey = new Map<string, boolean>();
      for (const decision of decisionsInput) {
        const key = decision.paymentGroupId ? `group:${decision.paymentGroupId}` : decision.paymentId ? `payment:${decision.paymentId}` : "";
        if (!key || !paymentGroups.has(key) || decisionByKey.has(key))
          throw new ApiError(400, "Choose whether each supplier payment was actually transferred");
        decisionByKey.set(key, decision.wasTransferred);
      }
      if (decisionByKey.size !== paymentGroups.size)
        throw new ApiError(400, "Confirm whether each supplier payment group was actually transferred");
      const paymentGroupIds = [...new Set([...paymentGroups.values()].flatMap((group) => group.paymentGroupId ? [group.paymentGroupId] : []))];
      const standalonePaymentIds = [...new Set([...paymentGroups.values()].flatMap((group) => group.paymentGroupId ? [] : group.paymentIds))];
      const groupRows = purchase.payments.length ? await tx.supplierPayment.findMany({
        where: { OR: [
          ...(paymentGroupIds.length ? [{ paymentGroupId: { in: paymentGroupIds } }] : []),
          ...(standalonePaymentIds.length ? [{ id: { in: standalonePaymentIds } }] : []),
        ] },
        include: { reversals: true, transferDecisions: true },
      }) : [];
      const groupRowsByKey = new Map<string, typeof groupRows>();
      for (const payment of groupRows) {
        const key = payment.paymentGroupId ? `group:${payment.paymentGroupId}` : `payment:${payment.id}`;
        groupRowsByKey.set(key, [...(groupRowsByKey.get(key) ?? []), payment]);
      }
      for (const group of paymentGroups.values()) {
        const rows = groupRowsByKey.get(group.key) ?? [];
        if (!rows.some((row) => group.paymentIds.includes(row.id)) || rows.some((row) => row.supplierId !== purchase.supplierId))
          throw new ApiError(409, "Supplier payment allocations changed; refresh and try again");
        const existingDecisionValues = new Set(rows.flatMap((row) => row.transferDecisions.map((decision) => decision.wasTransferred)));
        if (existingDecisionValues.size > 1 || (existingDecisionValues.size === 1 && !existingDecisionValues.has(decisionByKey.get(group.key)!)))
          throw new ApiError(409, "This supplier payment group already has a different transfer decision");
      }
      const refundNow = input.refundNow ?? [];
      const refundPending = input.refundPending ?? [];
      const refundNowByPayment = new Map<string, Prisma.Decimal>();
      const refundPendingByPayment = new Map<string, Prisma.Decimal>();
      const addRefundLines = (lines: any[], target: Map<string, Prisma.Decimal>) => {
        for (const line of lines) {
          const payment = purchase.payments.find((row) => row.id === line.originalPaymentId);
          if (!payment) throw new ApiError(400, "Each refund must link to an original payment on this purchase");
          target.set(payment.id, (target.get(payment.id) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(line.amount)));
        }
      };
      addRefundLines(refundNow, refundNowByPayment);
      addRefundLines(refundPending, refundPendingByPayment);
      const refundNowTotal = refundNow.reduce((sum: Prisma.Decimal, refund: any) => sum.add(new Prisma.Decimal(refund.amount)), new Prisma.Decimal(0));
      const refundPendingTotal = refundPending.reduce((sum: Prisma.Decimal, refund: any) => sum.add(new Prisma.Decimal(refund.amount)), new Prisma.Decimal(0));
      const netPaymentById = new Map(purchase.payments.map((payment) => [payment.id, Prisma.Decimal.max(new Prisma.Decimal(0), payment.amount.sub(payment.reversals.reduce((sum, reversal) => sum.add(reversal.amount), new Prisma.Decimal(0))))]));
      const paidAmount = [...netPaymentById.values()].reduce((sum, value) => sum.add(value), new Prisma.Decimal(0));
      for (const payment of purchase.payments) {
        const refundAmount = (refundNowByPayment.get(payment.id) ?? new Prisma.Decimal(0)).add(refundPendingByPayment.get(payment.id) ?? new Prisma.Decimal(0));
        const groupKey = payment.paymentGroupId ? `group:${payment.paymentGroupId}` : `payment:${payment.id}`;
        if (refundAmount.gt(0) && !decisionByKey.get(groupKey))
          throw new ApiError(400, "A refund can only be recorded when that payment was actually transferred");
        if (refundAmount.gt(netPaymentById.get(payment.id) ?? new Prisma.Decimal(0)))
          throw new ApiError(400, "Refund amounts cannot exceed the original payment allocation");
      }
      if (refundNowTotal.add(refundPendingTotal).gt(paidAmount))
        throw new ApiError(400, "Refund amounts cannot exceed the payment allocated to this purchase");
      const untransferredPurchaseIds = [...new Set([...paymentGroups.values()]
        .filter((group) => !decisionByKey.get(group.key))
        .flatMap((group) => (groupRowsByKey.get(group.key) ?? []).map((payment) => payment.purchaseId).filter((purchaseId): purchaseId is string => Boolean(purchaseId))))]
        .filter((purchaseId) => purchaseId !== id)
        .sort();
      for (const affectedPurchaseId of untransferredPurchaseIds) {
        const affectedPurchase = await tx.purchase.findUnique({ where: { id: affectedPurchaseId }, select: { status: true } });
        if (affectedPurchase?.status !== "POSTED") continue;
        const locked = await tx.purchase.updateMany({ where: { id: affectedPurchaseId, status: "POSTED" }, data: { updatedAt: new Date() } });
        if (locked.count !== 1)
          throw new ApiError(409, "A purchase in this payment group changed; refresh and try again");
      }
      const changedPurchase = await tx.purchase.updateMany({
        where: { id, status: "POSTED" },
        data: { status: "CANCELLED" },
      });
      if (changedPurchase.count !== 1)
        throw new ApiError(409, "Purchase status changed while cancellation was being processed");
      const cancellation = await tx.purchaseCancellation.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          purchaseId: purchase.id,
          reason,
          cancelledById: userId,
        },
        include: { paymentReversals: true },
      });
      const transferDecisionRows = [...paymentGroups.values()].flatMap((group) => (groupRowsByKey.get(group.key) ?? []).map((payment) => ({
        cancellationId: cancellation.id,
        originalPaymentId: payment.id,
        paymentGroupId: payment.paymentGroupId,
        wasTransferred: decisionByKey.get(group.key)!,
      })));
      if (transferDecisionRows.length)
        await tx.supplierPaymentTransferDecision.createMany({ data: transferDecisionRows, skipDuplicates: true });

      const paymentReversalRows: Array<{ cancellationId: string; originalPaymentId: string; amount: Prisma.Decimal; reason: string }> = [];
      for (const group of paymentGroups.values()) {
        const wasTransferred = decisionByKey.get(group.key)!;
        const rows = wasTransferred ? group.targetPayments : groupRowsByKey.get(group.key) ?? [];
        for (const payment of rows) {
          const reversed = payment.reversals.reduce((sum, reversal) => sum.add(reversal.amount), new Prisma.Decimal(0));
          const remaining = Prisma.Decimal.max(new Prisma.Decimal(0), payment.amount.sub(reversed));
          if (remaining.gt(0)) paymentReversalRows.push({ cancellationId: cancellation.id, originalPaymentId: payment.id, amount: remaining, reason });
        }
      }
      if (paymentReversalRows.length)
        await tx.supplierPaymentReversal.createMany({ data: paymentReversalRows, skipDuplicates: true });
      if (purchase.supplierCreditApplications.length) {
        await tx.supplierCreditApplicationReversal.createMany({
          data: purchase.supplierCreditApplications.map((application) => ({
            cancellationId: cancellation.id,
            applicationId: application.id,
            amount: application.amount,
          })),
        });
      }
      if (refundNowTotal.add(refundPendingTotal).gt(0)) {
        await tx.supplierRefund.create({
          data: {
            cancellationId: cancellation.id,
            amount: refundNowTotal.add(refundPendingTotal),
            settlements: refundNowTotal.gt(0) ? {
              create: [{
                idempotencyKey: input.idempotencyKey,
                createdById: userId,
                settledAt: input.refundDate ?? new Date(),
                lines: { create: refundNow.map((refund: any) => ({ originalPaymentId: refund.originalPaymentId, amount: new Prisma.Decimal(refund.amount), method: refund.method, reference: refund.reference?.trim() || null })) },
              }],
            } : undefined,
          },
        });
      }
      for (const payment of purchase.payments) {
        const groupKey = payment.paymentGroupId ? `group:${payment.paymentGroupId}` : `payment:${payment.id}`;
        if (!decisionByKey.get(groupKey)) continue;
        const refundedNow = refundNowByPayment.get(payment.id) ?? new Prisma.Decimal(0);
        const refundPendingAmount = refundPendingByPayment.get(payment.id) ?? new Prisma.Decimal(0);
        const retained = (netPaymentById.get(payment.id) ?? new Prisma.Decimal(0)).sub(refundedNow).sub(refundPendingAmount);
        if (retained.gt(0)) {
          await tx.supplierCredit.create({
            data: {
              supplierId: purchase.supplierId,
              cancellationId: cancellation.id,
              sourcePaymentId: payment.id,
              amount: retained,
            },
          });
        }
      }
      const quantitiesByProduct = new Map<string, Prisma.Decimal>();
      for (const item of purchase.items) {
        quantitiesByProduct.set(item.productId, (quantitiesByProduct.get(item.productId) ?? new Prisma.Decimal(0)).add(item.quantity));
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
      }
      const stockAfterByProduct = new Map<string, Prisma.Decimal>();
      for (const [productId, quantity] of quantitiesByProduct) {
        const changed = await tx.product.updateMany({
          where: { id: productId, currentStock: { gte: quantity } },
          data: { currentStock: { decrement: quantity } },
        });
        if (changed.count !== 1)
          throw new ApiError(
            409,
            "Purchase cannot be cancelled because some purchased stock has already been sold or adjusted",
          );
        const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { currentStock: true } });
        stockAfterByProduct.set(productId, product.currentStock);
      }
      for (const item of purchase.items) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            inventoryBatchId: item.inventoryBatch!.id,
            type: "PURCHASE_CANCEL",
            direction: "OUT",
            quantity: item.quantity,
            stockAfter: stockAfterByProduct.get(item.productId)!,
            reason: `Purchase cancellation ${purchase.purchaseNumber}`,
            notes: reason,
            createdById: userId,
          },
        });
      }
      await applySupplierCredits(tx, purchase.supplierId);
      const finalCancellation = await tx.purchaseCancellation.findUniqueOrThrow({
        where: { id: cancellation.id },
        include: {
          paymentReversals: true,
          supplierRefund: { include: { settlements: { include: { lines: true } } } },
          supplierCredits: { include: { applications: true } },
          supplierCreditApplicationReversals: true,
        },
      });
      return { ...purchase, status: "CANCELLED", supplierCreditApplications: [], cancellation: finalCancellation };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
  );
}

export async function settleSupplierRefund(purchaseId: string, input: any, userId?: string) {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.supplierRefundSettlement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { lines: true } });
    if (prior) return { id: prior.id, replayed: true };
    const purchase = await tx.purchase.findUnique({
      where: { id: purchaseId },
      include: { cancellation: { include: { paymentReversals: true, supplierRefund: { include: { settlements: { include: { lines: true } } } } } } },
    });
    const refund = purchase?.cancellation?.supplierRefund;
    if (!purchase || purchase.status !== "CANCELLED" || !refund)
      throw new ApiError(404, "This cancelled purchase has no supplier refund to settle");
    const settled = refund.settlements.flatMap((row) => row.lines).reduce((sum, line) => sum.add(line.amount), new Prisma.Decimal(0));
    const pending = refund.amount.sub(settled);
    const lines = input.refunds ?? [];
    const settlementAmount = lines.reduce((sum: Prisma.Decimal, line: any) => sum.add(new Prisma.Decimal(line.amount)), new Prisma.Decimal(0));
    if (settlementAmount.lte(0) || settlementAmount.gt(pending))
      throw new ApiError(400, "Refund settlement must be positive and cannot exceed the pending supplier refund");
    const allocationSettled = new Map<string, Prisma.Decimal>();
    for (const line of refund.settlements.flatMap((row) => row.lines)) {
      allocationSettled.set(line.originalPaymentId, (allocationSettled.get(line.originalPaymentId) ?? new Prisma.Decimal(0)).add(line.amount));
    }
    const allocationRequested = new Map<string, Prisma.Decimal>();
    for (const line of lines) {
      const originalPayment = purchase.cancellation!.paymentReversals.find((row) => row.originalPaymentId === line.originalPaymentId);
      if (!originalPayment) throw new ApiError(400, "Each refund line must link to an original payment allocation on this purchase");
      const requested = (allocationRequested.get(line.originalPaymentId) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(line.amount));
      const alreadySettled = allocationSettled.get(line.originalPaymentId) ?? new Prisma.Decimal(0);
      if (alreadySettled.add(requested).gt(originalPayment.amount))
        throw new ApiError(400, "Refund settlement cannot exceed the remaining amount for its original payment allocation");
      allocationRequested.set(line.originalPaymentId, requested);
    }
    const settlement = await tx.supplierRefundSettlement.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        refundId: refund.id,
        createdById: userId,
        settledAt: input.settledAt ?? new Date(),
      lines: { create: lines.map((line: any) => ({ originalPaymentId: line.originalPaymentId, amount: new Prisma.Decimal(line.amount), method: line.method, reference: line.reference?.trim() || null })) },
      },
      include: { lines: true },
    });
    return { id: settlement.id, amount: settlementAmount.toFixed(2), pendingAmount: pending.sub(settlementAmount).toFixed(2), replayed: false };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
}
