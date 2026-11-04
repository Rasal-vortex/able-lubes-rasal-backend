import { ApiError } from "../../shared/errors.js";
import { prisma } from "../../config/prisma.js";
import { pageMeta } from "../../shared/pagination.js";
import { productModel } from "./product.model.js";
import { productSerializer } from "./product.serializer.js";
import { validateQuantity } from "../../shared/quantity.js";

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
  const { qty = 0, ...product } = data;
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
      const created = await tx.product.create({
        data: { ...product, currentStock: qty },
        include: { brand: true, unit: true },
      });
      if (Number(qty) > 0)
        await tx.stockMovement.create({
          data: {
            productId: created.id,
            type: "OPENING_STOCK",
            direction: "IN",
            quantity: qty,
            stockAfter: qty,
            reason: "Initial product quantity",
            createdById: userId,
          },
        });
      return created;
    }),
  );
}

export async function updateProduct(id: string, data: any) {
  return productSerializer(
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id },
        include: { unit: true, brand: true },
      });
      if (!product) throw new ApiError(404, "Product not found");
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
          const [sales, purchases, movements] = await Promise.all([
            tx.saleItem.count({ where: { productId: id } }),
            tx.purchaseItem.count({ where: { productId: id } }),
            tx.stockMovement.count({ where: { productId: id } }),
          ]);
          if (sales || purchases || movements)
            throw new ApiError(
              409,
              "Product unit cannot be changed after transaction or stock history exists",
            );
          if (product.currentStock.gt(0))
            validateQuantity(product.currentStock.toString(), unit);
        }
      }
      const updated = await tx.product.update({
        where: { id },
        data,
        include: { unit: true, brand: true },
      });
      return updated;
    }),
  );
}
