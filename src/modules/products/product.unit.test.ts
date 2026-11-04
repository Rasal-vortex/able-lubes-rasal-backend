import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  product: null as any,
  counts: { sale: 0, purchase: 0, movement: 0 },
  update: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) =>
      callback({
        product: {
          findUnique: async () => state.product,
          update: state.update,
        },
        brand: { findFirst: vi.fn() },
        unit: {
          findFirst: async () => ({
            id: "unit-new",
            name: "Can",
            allowsDecimals: false,
          }),
        },
        saleItem: { count: async () => state.counts.sale },
        purchaseItem: { count: async () => state.counts.purchase },
        stockMovement: { count: async () => state.counts.movement },
      }),
  },
}));

import { updateProduct } from "./product.service.js";

describe("product unit history protection", () => {
  beforeEach(() => {
    state.product = {
      id: "product-1",
      unitId: "unit-old",
      unit: { id: "unit-old", name: "Bottle", allowsDecimals: false },
      brand: { id: "brand-1", name: "Brand" },
      currentStock: { gt: () => false, toString: () => "0" },
    };
    state.counts = { sale: 0, purchase: 0, movement: 0 };
    state.update.mockReset();
  });

  it("rejects changing units when any sales, purchases, or stock history exists", async () => {
    state.counts.purchase = 1;
    await expect(
      updateProduct("product-1", { unitId: "unit-new" }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(state.update).not.toHaveBeenCalled();
  });
});
