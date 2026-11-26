import { ApiError } from "../../shared/errors.js";
import { prisma } from "../../config/prisma.js";
import { pageMeta } from "../../shared/pagination.js";
import { productModel } from "./product.model.js";
import { productSerializer } from "./product.serializer.js";
import { validateQuantity } from "../../shared/quantity.js";
import { Prisma } from "../../../generated/prisma/client.js";

export async function listProducts(query: any) {
  const { page, limit, search, active } = query;
  const where: any = {
    ...(active === undefined ? {} : { active }),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { brand: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    productModel.list(where, (page - 1) * limit, limit),
    productModel.count(where),
  ]);
  return {
    data: rows.map(productSerializer),
    meta: pageMeta(page, limit, total),
  };
}
export async function getProduct(id: string) {
  const p = await productModel.get(id);
  if (!p) throw new ApiError(404, "Product not found");
  return productSerializer(p);
}

export async function createProduct(data: any, userId: string) {
  const { qty = 0, batches: batchInputs, ...product } = data;
  return productSerializer(
    await prisma.$transaction(async (tx) => {
      const [brand, unit] = await Promise.all([
        tx.brand.findFirst({
          where: { id: product.brandId, active: true },
          select: { id: true },
        }),
        tx.unit.findFirst({
          where: { id: product.unitId, active: true },
          select: { id: true },
        }),
      ]);
      if (!brand) throw new ApiError(400, "Brand is missing or inactive");
      if (!unit) throw new ApiError(400, "Unit is missing or inactive");
      const quantityUnit = await tx.unit.findUniqueOrThrow({
        where: { id: unit.id },
      });
      validateQuantity(qty, quantityUnit, { allowZero: true });
      for (const batch of batchInputs ?? []) validateQuantity(batch.quantity, quantityUnit);
      const created = await tx.product.create({
        data: { ...product, currentStock: qty },
        include: { brand: true, unit: true },
      });
      const initialBatches = batchInputs?.length
        ? batchInputs.map((batch: any) => ({ ...batch, source: "OPENING" as const }))
        : Number(qty) > 0
          ? [{
              label: "Opening stock",
              quantity: Number(qty),
              purchaseRate: created.purchaseRate,
              sellingRate: created.sellingPrice,
              mrp: created.mrp,
              source: "OPENING" as const,
            }]
          : [];
      let stockAfter = new Prisma.Decimal(0);
      for (const batchInput of initialBatches) {
        const openingBatch = await tx.inventoryBatch.create({
          data: {
            productId: created.id,
            label: batchInput.label ?? null,
            receivedQuantity: batchInput.quantity,
            remainingQuantity: batchInput.quantity,
            purchaseRate: batchInput.purchaseRate,
            sellingRate: batchInput.sellingRate,
            mrp: batchInput.mrp ?? null,
            receivedAt: new Date(),
            source: batchInput.source,
            status: "ACTIVE",
          },
        });
        stockAfter = stockAfter.add(batchInput.quantity);
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            inventoryBatchId: openingBatch.id,
            type: "OPENING_STOCK",
            direction: "IN",
            quantity: batchInput.quantity,
            stockAfter,
            reason: batchInput.label || "Initial product quantity",
            createdById: userId,
          },
        });
      }
      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          brand: true,
          unit: true,
          inventoryBatches: {
            where: { status: "ACTIVE", remainingQuantity: { gt: 0 } },
            orderBy: { receivedAt: "asc" },
          },
        },
      });
    }),
  );
}

export async function updateProduct(id: string, data: any, userRole: string, userId: string) {
  return productSerializer(
    await prisma.$transaction(
      async (tx) => {
        const product = await tx.product.findUnique({
          where: { id },
          include: { unit: true, brand: true },
        });
        if (!product) throw new ApiError(404, "Product not found");
        const sellingPrice = data.sellingPrice ?? product.sellingPrice;
        const mrp = data.mrp !== undefined ? data.mrp : product.mrp;
        if (
          (data.mrp !== undefined || data.sellingPrice !== undefined) &&
          mrp != null &&
          Number(mrp) <= Number(sellingPrice)
        )
          throw new ApiError(400, "MRP must be greater than selling price");
        if (
          data.brandId &&
          !(await tx.brand.findFirst({
            where: { id: data.brandId, active: true },
            select: { id: true },
          }))
        )
          throw new ApiError(400, "Brand is missing or inactive");
        if (data.unitId) {
          const unit = await tx.unit.findFirst({
            where: { id: data.unitId, active: true },
          });
          if (!unit) throw new ApiError(400, "Unit is missing or inactive");
          if (data.unitId !== product.unitId) {
            const [saleHistory, purchaseHistory, stockHistory] =
              await Promise.all([
                tx.saleItem.count({ where: { productId: id } }),
                tx.purchaseItem.count({ where: { productId: id } }),
                tx.stockMovement.count({ where: { productId: id } }),
              ]);
            if (saleHistory > 0 || purchaseHistory > 0 || stockHistory > 0)
              throw new ApiError(
                409,
                "The product unit cannot be changed because transaction or stock history exists.",
              );
            if (product.currentStock.gt(0))
              validateQuantity(product.currentStock.toString(), unit);
          }
        }
        const { batchPricing, ...productUpdates } = data;
        let currentStock = product.currentStock;
        if (batchPricing) {
          const currentBatches = await tx.inventoryBatch.findMany({ where: { productId: id, status: "ACTIVE" } });
          const batchById = new Map(currentBatches.map((batch) => [batch.id, batch]));
          const seen = new Set<string>();
          const targetBatches = new Map<string, { sellingRate: Prisma.Decimal; remainingQuantity: Prisma.Decimal }>();
          let stockAfter = product.currentStock;
          for (const update of batchPricing.updates) {
            if (seen.has(update.id)) throw new ApiError(400, "A stock batch can only be updated once per request");
            seen.add(update.id);
            const batch = batchById.get(update.id);
            if (!batch) throw new ApiError(409, "One of the selected stock batches is no longer available");
            const remainingQuantity = new Prisma.Decimal(update.remainingQuantity);
            if (remainingQuantity.gt(batch.remainingQuantity))
              throw new ApiError(409, "Increase stock by adding another batch; existing batch quantities cannot be increased");
            validateQuantity(remainingQuantity.toString(), product.unit, { allowZero: true });
            const reduction = batch.remainingQuantity.sub(remainingQuantity);
            if (reduction.gt(0) && userRole !== "ADMIN")
              throw new ApiError(403, "Only Admin users can reduce batch stock");
            const changed = await tx.inventoryBatch.updateMany({
              where: { id: batch.id, productId: id, status: "ACTIVE", remainingQuantity: batch.remainingQuantity },
              data: {
                ...(update.label !== undefined ? { label: update.label } : {}),
                remainingQuantity,
                sellingRate: new Prisma.Decimal(update.sellingRate),
              ...(update.mrp !== undefined ? { mrp: update.mrp } : {}),
                ...(remainingQuantity.isZero() ? { status: "DEPLETED" } : {}),
              },
            });
            if (changed.count !== 1) throw new ApiError(409, "Stock batch changed while updating the product; retry the request");
            if (reduction.gt(0)) {
              stockAfter = stockAfter.sub(reduction);
              currentStock = currentStock.sub(reduction);
              await tx.stockMovement.create({ data: {
                productId: id, inventoryBatchId: batch.id, type: "ADJUSTMENT", direction: "OUT",
                quantity: reduction, stockAfter, reason: "Batch quantity reduced from product management", createdById: userId,
              } });
            }
            targetBatches.set(batch.id, { sellingRate: new Prisma.Decimal(update.sellingRate), remainingQuantity });
          }
          if (batchPricing.additions.length && userRole !== "ADMIN")
            throw new ApiError(403, "Only Admin users can add stock batches");
          const clientKeyToBatch = new Map<string, string>();
          for (const addition of batchPricing.additions) {
            validateQuantity(addition.quantity, product.unit);
            if (addition.clientKey && clientKeyToBatch.has(addition.clientKey))
              throw new ApiError(400, "Each new stock batch needs a unique row key");
            const quantity = new Prisma.Decimal(addition.quantity);
            const batch = await tx.inventoryBatch.create({ data: {
              productId: id,
              label: addition.label ?? null,
              receivedQuantity: quantity,
              remainingQuantity: quantity,
              purchaseRate: new Prisma.Decimal(addition.purchaseRate),
              sellingRate: new Prisma.Decimal(addition.sellingRate),
              mrp: addition.mrp ?? null,
              receivedAt: new Date(),
              source: "ADJUSTMENT",
              status: "ACTIVE",
            } });
            if (addition.clientKey) clientKeyToBatch.set(addition.clientKey, batch.id);
            stockAfter = stockAfter.add(quantity);
            currentStock = currentStock.add(quantity);
            await tx.stockMovement.create({ data: {
              productId: id, inventoryBatchId: batch.id, type: "ADJUSTMENT", direction: "IN",
              quantity, stockAfter, reason: "New batch added from product management", createdById: userId,
            } });
            targetBatches.set(batch.id, { sellingRate: batch.sellingRate, remainingQuantity: batch.remainingQuantity });
          }
          for (const batch of currentBatches) {
            if (!targetBatches.has(batch.id)) targetBatches.set(batch.id, { sellingRate: batch.sellingRate, remainingQuantity: batch.remainingQuantity });
          }
          const defaultBatchId = clientKeyToBatch.get(batchPricing.defaultBatchKey) ?? batchPricing.defaultBatchKey;
          const defaultBatch = targetBatches.get(defaultBatchId);
          if (!defaultBatch || !defaultBatch.remainingQuantity.gt(0))
            throw new ApiError(400, "Choose a default selling rate from a batch with available stock");
          const updatedProductMrp = productUpdates.mrp !== undefined ? productUpdates.mrp : product.mrp;
          if (updatedProductMrp != null && new Prisma.Decimal(updatedProductMrp).lte(defaultBatch.sellingRate))
            throw new ApiError(400, "Product MRP must remain greater than its default selling price");
          productUpdates.sellingPrice = defaultBatch.sellingRate;
        }
        const updated = await tx.product.update({
          where: { id },
          data: { ...productUpdates, ...(batchPricing ? { currentStock } : {}) },
          include: { unit: true, brand: true, inventoryBatches: { where: { status: "ACTIVE", remainingQuantity: { gt: 0 } }, orderBy: { receivedAt: "asc" } } },
        });
        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
