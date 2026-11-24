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
  const { qty = 0, batches, ...product } = data;
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
      const batchInputs = batches ?? (Number(qty) > 0 ? [{
        label: "Opening stock",
        quantity: qty,
        purchaseRate: product.purchaseRate,
        sellingRate: product.sellingPrice,
        mrp: product.mrp ?? null,
        isDefaultSellingRate: true,
      }] : []);
      for (const batch of batchInputs) validateQuantity(batch.quantity, quantityUnit);
      const totalQuantity = batchInputs.reduce((total: Prisma.Decimal, batch: any) => total.add(new Prisma.Decimal(batch.quantity)), new Prisma.Decimal(0));
      const defaultBatch = batchInputs.find((batch: any) => batch.isDefaultSellingRate);
      if (batches && (!defaultBatch || batchInputs.filter((batch: any) => batch.isDefaultSellingRate).length !== 1)) {
        throw new ApiError(400, "Select exactly one default selling rate");
      }
      const totalCost = batchInputs.reduce((total: Prisma.Decimal, batch: any) => total.add(new Prisma.Decimal(batch.quantity).mul(batch.purchaseRate)), new Prisma.Decimal(0));
      const averagePurchaseRate = totalQuantity.gt(0)
        ? totalCost.div(totalQuantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
        : new Prisma.Decimal(product.purchaseRate);
      const created = await tx.product.create({
        data: {
          ...product,
          purchaseRate: averagePurchaseRate,
          sellingPrice: defaultBatch?.sellingRate ?? product.sellingPrice,
          mrp: defaultBatch?.mrp ?? (defaultBatch ? null : product.mrp),
          currentStock: totalQuantity,
        },
        include: { brand: true, unit: true },
      });
      let stockAfter = new Prisma.Decimal(0);
      for (const [index, batch] of batchInputs.entries()) {
        const batchQuantity = new Prisma.Decimal(batch.quantity);
        const createdBatch = await tx.inventoryBatch.create({
          data: {
            productId: created.id,
            label: batch.label?.trim() || `Opening batch ${index + 1}`,
            receivedQuantity: batchQuantity,
            remainingQuantity: batchQuantity,
            purchaseRate: new Prisma.Decimal(batch.purchaseRate),
            sellingRate: new Prisma.Decimal(batch.sellingRate),
            mrp: batch.mrp == null ? null : new Prisma.Decimal(batch.mrp),
            isDefaultSellingRate: Boolean(batch.isDefaultSellingRate),
            receivedAt: new Date(),
            source: "OPENING",
            status: "ACTIVE",
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            inventoryBatchId: createdBatch.id,
            type: "OPENING_STOCK",
            direction: "IN",
            quantity: batchQuantity,
            stockAfter: stockAfter.add(batchQuantity),
            reason: "Initial product batch",
            notes: createdBatch.label,
            createdById: userId,
          },
        });
        stockAfter = stockAfter.add(batchQuantity);
      }
      return tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          brand: true,
          unit: true,
          inventoryBatches: {
            where: { status: "ACTIVE", remainingQuantity: { gt: 0 } },
          },
        },
      });
    }),
  );
}

export async function updateProduct(id: string, data: any, userId?: string, userRole = "STAFF") {
  return productSerializer(
    await prisma.$transaction(
      async (tx) => {
        const { batchPricing, ...requestedProductData } = data;
        const product = await tx.product.findUnique({
          where: { id },
          include: { unit: true, brand: true },
        });
        if (!product) throw new ApiError(404, "Product not found");
        const sellingPrice = requestedProductData.sellingPrice ?? product.sellingPrice;
        const mrp = requestedProductData.mrp !== undefined ? requestedProductData.mrp : product.mrp;
        if (
          (requestedProductData.mrp !== undefined || requestedProductData.sellingPrice !== undefined) &&
          mrp != null &&
          Number(mrp) <= Number(sellingPrice)
        )
          throw new ApiError(400, "MRP must be greater than selling price");
        if (
          requestedProductData.brandId &&
          !(await tx.brand.findFirst({
            where: { id: requestedProductData.brandId, active: true },
            select: { id: true },
          }))
        )
          throw new ApiError(400, "Brand is missing or inactive");
        if (requestedProductData.unitId) {
          const unit = await tx.unit.findFirst({
            where: { id: requestedProductData.unitId, active: true },
          });
          if (!unit) throw new ApiError(400, "Unit is missing or inactive");
          if (requestedProductData.unitId !== product.unitId) {
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
        const productData = { ...requestedProductData };
        if (batchPricing) {
          delete (productData as any).purchaseRate;
          delete (productData as any).sellingPrice;
          delete (productData as any).mrp;
        }
        await tx.product.update({ where: { id }, data: productData });

        if (batchPricing) {
          const batchAggregate = await tx.inventoryBatch.aggregate({
            where: { productId: id },
            _sum: { remainingQuantity: true },
          });
          const batchStock = batchAggregate._sum.remainingQuantity ?? new Prisma.Decimal(0);
          if (!batchStock.eq(product.currentStock))
            throw new ApiError(409, "Product stock does not reconcile with its inventory batches; reconcile stock before editing batches");

          const updateIds: string[] = batchPricing.updates.map((batch: any) => batch.id);
          const existingBatches = updateIds.length
            ? await tx.inventoryBatch.findMany({ where: { id: { in: updateIds }, productId: id, status: "ACTIVE" } })
            : [];
          if (existingBatches.length !== updateIds.length)
            throw new ApiError(409, "One or more batches are no longer available; refresh the product and retry");
          const existingById = new Map(existingBatches.map((batch) => [batch.id, batch]));
          let currentStock = product.currentStock;
          const updatedById = new Map<string, any>();

          for (const change of batchPricing.updates as Array<any>) {
            const existing = existingById.get(change.id)!;
            validateQuantity(change.remainingQuantity, product.unit, { allowZero: true });
            const nextRemaining = new Prisma.Decimal(change.remainingQuantity);
            if (nextRemaining.gt(existing.remainingQuantity))
              throw new ApiError(400, "Increase stock by adding a new batch; existing batch quantities cannot be increased");
            if (nextRemaining.lt(existing.remainingQuantity) && userRole !== "ADMIN")
              throw new ApiError(403, "Only Admin users can reduce batch stock");
            const nextMrp = change.mrp === undefined ? existing.mrp : change.mrp == null ? null : new Prisma.Decimal(change.mrp);
            if (nextMrp != null && nextMrp.lte(change.sellingRate))
              throw new ApiError(400, "Batch MRP must be greater than its selling price");
            const nextLabel = change.label === undefined ? existing.label : change.label?.trim() || null;
            const delta = existing.remainingQuantity.sub(nextRemaining);
            const changed = await tx.inventoryBatch.updateMany({
              where: { id: existing.id, productId: id, status: "ACTIVE", remainingQuantity: existing.remainingQuantity },
              data: {
                remainingQuantity: nextRemaining,
                status: nextRemaining.isZero() ? "DEPLETED" : "ACTIVE",
                sellingRate: new Prisma.Decimal(change.sellingRate),
                mrp: nextMrp,
                label: nextLabel,
              },
            });
            if (changed.count !== 1) throw new ApiError(409, "A batch changed while saving; refresh and retry");
            if (delta.gt(0)) {
              const stockChanged = await tx.product.updateMany({ where: { id, currentStock: { gte: delta } }, data: { currentStock: { decrement: delta } } });
              if (stockChanged.count !== 1) throw new ApiError(409, "Product stock changed while reducing a batch; refresh and retry");
              currentStock = currentStock.sub(delta);
              await tx.stockMovement.create({ data: {
                productId: id, inventoryBatchId: existing.id, type: "ADJUSTMENT", direction: "OUT", quantity: delta,
                stockAfter: currentStock, reason: "Product batch quantity reduced", notes: "Batch quantity edited in product drawer", createdById: userId,
              } });
            }
            updatedById.set(existing.id, { ...existing, remainingQuantity: nextRemaining, status: nextRemaining.isZero() ? "DEPLETED" : "ACTIVE", sellingRate: new Prisma.Decimal(change.sellingRate), mrp: nextMrp, label: nextLabel });
          }

          if (batchPricing.additions.length && userRole !== "ADMIN")
            throw new ApiError(403, "Only Admin users can add stock batches");
          const createdByKey = new Map<string, any>();
          for (const [index, batch] of (batchPricing.additions as Array<any>).entries()) {
            validateQuantity(batch.quantity, product.unit);
            const quantity = new Prisma.Decimal(batch.quantity);
            const createdBatch = await tx.inventoryBatch.create({
              data: {
                productId: id,
                label: batch.label?.trim() || `Added batch ${index + 1}`,
                receivedQuantity: quantity,
                remainingQuantity: quantity,
                purchaseRate: new Prisma.Decimal(batch.purchaseRate),
                sellingRate: new Prisma.Decimal(batch.sellingRate),
                mrp: batch.mrp == null ? null : new Prisma.Decimal(batch.mrp),
                isDefaultSellingRate: false,
                receivedAt: new Date(),
                source: "ADJUSTMENT",
                status: "ACTIVE",
              },
            });
            const stockChanged = await tx.product.update({ where: { id }, data: { currentStock: { increment: quantity } }, select: { currentStock: true } });
            currentStock = stockChanged.currentStock;
            await tx.stockMovement.create({ data: {
              productId: id, inventoryBatchId: createdBatch.id, type: "ADJUSTMENT", direction: "IN", quantity,
              stockAfter: currentStock, reason: "Product batch added", notes: createdBatch.label, createdById: userId,
            } });
            if (batch.clientKey) createdByKey.set(batch.clientKey, createdBatch);
          }

          let selectedDefault: any = null;
          if (batchPricing.defaultBatchKey) {
            selectedDefault = updatedById.get(batchPricing.defaultBatchKey)
              ?? createdByKey.get(batchPricing.defaultBatchKey)
              ?? existingById.get(batchPricing.defaultBatchKey);
            if (!selectedDefault) {
              selectedDefault = await tx.inventoryBatch.findFirst({ where: { id: batchPricing.defaultBatchKey, productId: id, status: "ACTIVE", remainingQuantity: { gt: 0 } } });
            }
            if (!selectedDefault || selectedDefault.status !== "ACTIVE" || !new Prisma.Decimal(selectedDefault.remainingQuantity).gt(0))
              throw new ApiError(400, "The default selling rate must belong to a batch with available stock");
          }
          await tx.inventoryBatch.updateMany({ where: { productId: id }, data: { isDefaultSellingRate: false } });
          if (selectedDefault) {
            await tx.inventoryBatch.update({ where: { id: selectedDefault.id }, data: { isDefaultSellingRate: true } });
            await tx.product.update({ where: { id }, data: { sellingPrice: selectedDefault.sellingRate, mrp: selectedDefault.mrp } });
          }
        } else if (requestedProductData.sellingPrice !== undefined || requestedProductData.mrp !== undefined) {
          const defaultBatch = await tx.inventoryBatch.findFirst({ where: { productId: id, isDefaultSellingRate: true, status: "ACTIVE", remainingQuantity: { gt: 0 } } });
          if (defaultBatch) {
            const nextSellingRate = requestedProductData.sellingPrice ?? defaultBatch.sellingRate;
            const nextMrp = requestedProductData.mrp !== undefined ? requestedProductData.mrp : defaultBatch.mrp;
            await tx.inventoryBatch.update({ where: { id: defaultBatch.id }, data: { sellingRate: nextSellingRate, mrp: nextMrp } });
          }
        }
        return tx.product.findUniqueOrThrow({
          where: { id },
          include: {
            brand: true,
            unit: true,
            inventoryBatches: { where: { status: "ACTIVE", remainingQuantity: { gt: 0 } }, orderBy: { receivedAt: "asc" } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 },
    ),
  );
}
