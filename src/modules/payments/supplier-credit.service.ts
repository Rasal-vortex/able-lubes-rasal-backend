import { Prisma } from "../../../generated/prisma/client.js";
import { ApiError } from "../../shared/errors.js";

const zero = () => new Prisma.Decimal(0);

/** Apply available supplier credit to posted purchases in the same FIFO order used for payments. */
export async function applySupplierCredits(
  tx: Prisma.TransactionClient,
  supplierId: string,
) {
  const lockedSupplier = await tx.supplier.updateMany({
    where: { id: supplierId },
    data: { updatedAt: new Date() },
  });
  if (lockedSupplier.count !== 1) throw new ApiError(404, "Supplier not found");

  const credits = await tx.supplierCredit.findMany({
    where: { supplierId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      applications: { select: { amount: true, reversals: { select: { id: true } } } },
      reversals: { select: { amount: true } },
    },
  });
  const purchases = await tx.purchase.findMany({
    where: { supplierId, status: "POSTED" },
    orderBy: [{ purchaseDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      payments: { select: { amount: true, reversals: { select: { amount: true } } } },
      supplierCreditApplications: {
        select: { amount: true, reversals: { select: { id: true } } },
      },
    },
  });

  const availableByCredit = new Map<string, Prisma.Decimal>();
  for (const credit of credits) {
    const applied = credit.applications.reduce(
      (total, application) =>
        application.reversals.length ? total : total.add(application.amount),
      zero(),
    );
    const reversed = credit.reversals.reduce((total, reversal) => total.add(reversal.amount), zero());
    availableByCredit.set(credit.id, Prisma.Decimal.max(zero(), credit.amount.sub(applied).sub(reversed)));
  }

  const outstandingByPurchase = new Map<string, Prisma.Decimal>();
  for (const purchase of purchases) {
    const paid = purchase.payments.reduce((total, payment) => total.add(Prisma.Decimal.max(zero(), payment.amount.sub(payment.reversals.reduce((sum, reversal) => sum.add(reversal.amount), zero())))), zero());
    const creditApplied = purchase.supplierCreditApplications.reduce(
      (total, application) =>
        application.reversals.length ? total : total.add(application.amount),
      zero(),
    );
    outstandingByPurchase.set(
      purchase.id,
      Prisma.Decimal.max(zero(), purchase.totalAmount.sub(paid).sub(creditApplied)),
    );
  }

  const applicationRows: Array<{ creditId: string; purchaseId: string; amount: Prisma.Decimal }> = [];
  for (const credit of credits) {
    let remaining = availableByCredit.get(credit.id) ?? zero();
    for (const purchase of purchases) {
      if (remaining.isZero()) break;
      const outstanding = outstandingByPurchase.get(purchase.id) ?? zero();
      if (outstanding.isZero()) continue;
      const allocation = Prisma.Decimal.min(remaining, outstanding);
      if (allocation.lte(0)) continue;

      const lockedPurchase = await tx.purchase.updateMany({
        where: { id: purchase.id, status: "POSTED" },
        data: { updatedAt: new Date() },
      });
      if (lockedPurchase.count !== 1)
        throw new ApiError(409, "A purchase changed while applying supplier credit; refresh and retry");

      await tx.supplierCreditApplication.create({
        data: { creditId: credit.id, purchaseId: purchase.id, amount: allocation },
      });
      applicationRows.push({ creditId: credit.id, purchaseId: purchase.id, amount: allocation });
      remaining = remaining.sub(allocation);
      outstandingByPurchase.set(purchase.id, outstanding.sub(allocation));
    }
    availableByCredit.set(credit.id, remaining);
  }

  return { applications: applicationRows, remainingByCredit: availableByCredit };
}
