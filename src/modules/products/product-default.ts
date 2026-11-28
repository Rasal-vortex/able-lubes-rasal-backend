import { Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../shared/errors.js";

type DefaultBatchCandidate = {
  id: string;
  status: string;
  remainingQuantity: Prisma.Decimal | number | string;
  isDefaultSellingRate: boolean;
  createdAt: Date;
  sellingRate: Prisma.Decimal | number | string;
  mrp: Prisma.Decimal | number | string | null;
};

const newestFirst = <T extends DefaultBatchCandidate>(left: T, right: T) => {
  const byCreatedAt = right.createdAt.getTime() - left.createdAt.getTime();
  return byCreatedAt || right.id.localeCompare(left.id);
};

/** Resolve the listing batch without changing inventory or persistence. */
export function resolveEffectiveDefaultBatch<T extends DefaultBatchCandidate>(batches: T[]): T | null {
  const available = batches
    .filter((batch) => batch.status === "ACTIVE" && new Prisma.Decimal(batch.remainingQuantity).gt(0))
    .sort(newestFirst);
  return available.find((batch) => batch.isDefaultSellingRate) ?? available[0] ?? null;
}

/** Synchronize the selected available batch and its product-level listing prices in the caller's transaction. */
export async function synchronizeProductListingDefault(tx: Prisma.TransactionClient, productId: string) {
  const [batches, product] = await Promise.all([
    tx.inventoryBatch.findMany({ where: { productId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    tx.product.findUnique({ where: { id: productId }, select: { sellingPrice: true, mrp: true } }),
  ]);
  if (!product) return null;

  const selected = resolveEffectiveDefaultBatch(batches);
  await tx.inventoryBatch.updateMany({
    where: { productId, isDefaultSellingRate: true, ...(selected ? { id: { not: selected.id } } : {}) },
    data: { isDefaultSellingRate: false },
  });

  if (!selected) return null;

  if (!selected.isDefaultSellingRate) {
    const marked = await tx.inventoryBatch.updateMany({
      where: { id: selected.id, productId, status: "ACTIVE", remainingQuantity: { gt: 0 } },
      data: { isDefaultSellingRate: true },
    });
    if (marked.count !== 1) throw new ApiError(409, "Default inventory batch changed while synchronizing product prices");
  }

  const sellingPrice = new Prisma.Decimal(selected.sellingRate);
  const mrp = selected.mrp == null ? null : new Prisma.Decimal(selected.mrp);
  const sameSellingPrice = product.sellingPrice.eq(sellingPrice);
  const sameMrp = mrp == null ? product.mrp == null : product.mrp != null && product.mrp.eq(mrp);
  if (!sameSellingPrice || !sameMrp) {
    await tx.product.update({ where: { id: productId }, data: { sellingPrice, mrp } });
  }
  return selected;
}
