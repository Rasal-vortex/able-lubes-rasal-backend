import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  product: null as any,
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
        stockMovement: { create: state.movementCreate },
      }),
    stockMovement: { findMany: vi.fn(), count: vi.fn() },
  },
}));

import { createAdjustment } from "./stock.service.js";

describe("stock adjustment unit quantities", () => {
  beforeEach(() => {
    state.product = {
      id: "product-1",
      unitId: "unit-1",
      unit: { id: "unit-1", name: "Bottle", allowsDecimals: false },
      currentStock: { lt: () => false, add: () => "6", sub: () => "4" },
    };
    state.productUpdateMany.mockReset();
    state.movementCreate.mockReset();
  });

  it("rejects fractional adjustments before changing stock or adding history", async () => {
    await expect(
      createAdjustment(
        {
          productId: "product-1",
          quantity: "1.5",
          direction: "IN",
          reason: "Count",
        },
        "user-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Bottle quantities must be whole numbers",
    });
    expect(state.productUpdateMany).not.toHaveBeenCalled();
    expect(state.movementCreate).not.toHaveBeenCalled();
  });
});
