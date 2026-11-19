import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({
  product: null as any,
  batch: null as any,
  batchCreate: vi.fn(),
  batchUpdateMany: vi.fn(),
  productUpdateMany: vi.fn(),
  movementCreate: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) =>
      callback({
        product: {
          findFirst: async () => state.product,
          updateMany: state.productUpdateMany,
        },
        inventoryBatch: {
          create: state.batchCreate,
          findUnique: async () => state.batch,
          updateMany: state.batchUpdateMany,
        },
        stockMovement: { create: state.movementCreate },
      }),
  },
}));

import { createAdjustment } from "./stock.service.js";
import { adjustmentSchema } from "./stock.schema.js";

describe("batch-aware stock adjustments", () => {
  beforeEach(() => {
    state.product = {
      id: "product-1",
      unitId: "unit-1",
      unit: { id: "unit-1", name: "Litre", symbol: "L", allowsDecimals: true },
      currentStock: new Prisma.Decimal("10"),
    };
    state.batch = {
      id: "batch-1",
      productId: "product-1",
      status: "ACTIVE",
      receivedQuantity: new Prisma.Decimal("5"),
      remainingQuantity: new Prisma.Decimal("5"),
    };
    state.batchCreate.mockReset().mockImplementation(async ({ data }: any) => ({
      id: "batch-new",
      ...data,
    }));
    state.batchUpdateMany
      .mockReset()
      .mockImplementation(async ({ where, data }: any) => {
        if (
          !state.batch ||
          state.batch.id !== where.id ||
          state.batch.status !== where.status ||
          state.batch.remainingQuantity.lt(where.remainingQuantity.gte)
        )
          return { count: 0 };
        state.batch.remainingQuantity = state.batch.remainingQuantity.sub(
          data.remainingQuantity.decrement,
        );
        if (data.status) state.batch.status = data.status;
        return { count: 1 };
      });
    state.productUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    state.movementCreate
      .mockReset()
      .mockImplementation(async ({ data }: any) => ({
        id: "movement-1",
        ...data,
      }));
  });

  it("requires entered prices for increases and a selected batch for decreases", () => {
    const productId = "00000000-0000-4000-8000-000000000001";
    expect(
      adjustmentSchema.safeParse({ productId, quantity: 1, direction: "IN" })
        .success,
    ).toBe(false);
    expect(
      adjustmentSchema.safeParse({ productId, quantity: 1, direction: "OUT" })
        .success,
    ).toBe(false);
    expect(
      adjustmentSchema.safeParse({
        productId,
        quantity: 1,
        direction: "IN",
        purchaseRate: 400,
        sellingRate: 500,
      }).success,
    ).toBe(true);
    expect(
      adjustmentSchema.safeParse({
        productId,
        quantity: 1,
        direction: "OUT",
        inventoryBatchId: productId,
      }).success,
    ).toBe(true);
    expect(
      adjustmentSchema.safeParse({
        productId,
        quantity: 1,
        direction: "IN",
        purchaseRate: 0,
        sellingRate: 500,
      }).success,
    ).toBe(false);
    expect(
      adjustmentSchema.safeParse({
        productId,
        quantity: 1,
        direction: "IN",
        purchaseRate: 400.123,
        sellingRate: 500,
      }).success,
    ).toBe(false);
  });

  it("creates a priced adjustment batch and increments aggregate stock atomically", async () => {
    await createAdjustment(
      {
        productId: "product-1",
        quantity: "2.5",
        direction: "IN",
        purchaseRate: "400",
        sellingRate: "500",
        reason: "Count correction",
      },
      "user-1",
    );

    expect(state.batchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: "product-1",
        receivedQuantity: expect.anything(),
        remainingQuantity: expect.anything(),
        purchaseRate: expect.anything(),
        sellingRate: expect.anything(),
        source: "ADJUSTMENT",
        status: "ACTIVE",
      }),
    });
    const createdBatch = state.batchCreate.mock.calls[0][0].data;
    expect(createdBatch.purchaseRate.toString()).toBe("400");
    expect(createdBatch.sellingRate.toString()).toBe("500");
    expect(state.productUpdateMany.mock.calls[0][0].data.currentStock).toEqual({
      increment: expect.anything(),
    });
    expect(state.movementCreate.mock.calls[0][0].data.inventoryBatchId).toBe(
      "batch-new",
    );
  });

  it("reduces only the selected batch and aggregate product stock", async () => {
    await createAdjustment(
      {
        productId: "product-1",
        quantity: 2,
        direction: "OUT",
        inventoryBatchId: "batch-1",
      },
      "user-1",
    );

    expect(state.batchUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "batch-1",
          productId: "product-1",
          status: "ACTIVE",
        }),
        data: expect.objectContaining({
          remainingQuantity: { decrement: expect.anything() },
        }),
      }),
    );
    expect(state.productUpdateMany.mock.calls[0][0].data.currentStock).toEqual({
      decrement: expect.anything(),
    });
    expect(state.movementCreate.mock.calls[0][0].data.inventoryBatchId).toBe(
      "batch-1",
    );
  });

  it("rejects a reduction above the selected batch balance without updating aggregate stock", async () => {
    await expect(
      createAdjustment(
        {
          productId: "product-1",
          quantity: 6,
          direction: "OUT",
          inventoryBatchId: "batch-1",
        },
        "user-1",
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(state.batchUpdateMany).not.toHaveBeenCalled();
    expect(state.productUpdateMany).not.toHaveBeenCalled();
    expect(state.movementCreate).not.toHaveBeenCalled();
  });
});
