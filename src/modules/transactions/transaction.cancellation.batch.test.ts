import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({
  sale: null as any,
  purchase: null as any,
  saleUpdateMany: vi.fn(),
  purchaseUpdateMany: vi.fn(),
  batchUpdateMany: vi.fn(),
  productUpdateMany: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) =>
      callback({
        sale: {
          findUnique: async () => state.sale,
          updateMany: state.saleUpdateMany,
        },
        purchase: {
          findUnique: async () => state.purchase,
          updateMany: state.purchaseUpdateMany,
        },
        inventoryBatch: { updateMany: state.batchUpdateMany },
        product: { updateMany: state.productUpdateMany },
      }),
  },
}));

import { cancelPurchase, cancelSale } from "./transaction.service.js";

describe("batch-safe transaction cancellation", () => {
  beforeEach(() => {
    state.sale = {
      id: "sale-1",
      status: "POSTED",
      payments: [],
      items: [
        {
          productId: "product-1",
          quantity: new Prisma.Decimal("2"),
          inventoryBatchId: "batch-1",
          inventoryBatch: {
            id: "batch-1",
            productId: "product-1",
            status: "DEPLETED",
            receivedQuantity: new Prisma.Decimal("5"),
            remainingQuantity: new Prisma.Decimal("0"),
          },
        },
      ],
    };
    state.purchase = {
      id: "purchase-1",
      status: "POSTED",
      payments: [],
      items: [
        {
          id: "purchase-item-1",
          productId: "product-1",
          quantity: new Prisma.Decimal("5"),
          inventoryBatch: {
            id: "batch-1",
            productId: "product-1",
            purchaseItemId: "purchase-item-1",
            source: "PURCHASE",
            status: "ACTIVE",
            receivedQuantity: new Prisma.Decimal("5"),
            remainingQuantity: new Prisma.Decimal("5"),
          },
        },
      ],
    };
    state.saleUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    state.purchaseUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    state.batchUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    state.productUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("restores cancelled sale quantity to its exact original batch and aggregate stock", async () => {
    await cancelSale("sale-1");
    expect(state.batchUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "batch-1",
          remainingQuantity: expect.anything(),
        }),
        data: expect.objectContaining({
          remainingQuantity: { increment: expect.anything() },
          status: "ACTIVE",
        }),
      }),
    );
    expect(state.productUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "product-1" },
        data: { currentStock: { increment: expect.anything() } },
      }),
    );
  });

  it("allows cancellation of an unused purchase batch", async () => {
    await cancelPurchase("purchase-1");
    expect(state.purchaseUpdateMany).toHaveBeenCalledTimes(1);
    expect(state.batchUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "batch-1", status: "ACTIVE" }),
        data: { remainingQuantity: 0, status: "CANCELLED" },
      }),
    );
    expect(state.productUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "product-1",
          currentStock: { gte: state.purchase.items[0].quantity },
        },
        data: { currentStock: { decrement: state.purchase.items[0].quantity } },
      }),
    );
  });

  it("blocks purchase cancellation if its batch was consumed", async () => {
    state.purchase.items[0].inventoryBatch.remainingQuantity =
      new Prisma.Decimal("4");
    await expect(cancelPurchase("purchase-1")).rejects.toMatchObject({
      statusCode: 409,
      message:
        "Purchase cannot be cancelled because its stock batch has been sold or adjusted",
    });
    expect(state.purchaseUpdateMany).not.toHaveBeenCalled();
    expect(state.batchUpdateMany).not.toHaveBeenCalled();
    expect(state.productUpdateMany).not.toHaveBeenCalled();
  });
});
