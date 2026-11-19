import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  product: null as any,
  counts: { sale: 0, purchase: 0, movement: 0 },
  update: vi.fn(),
  saleCount: vi.fn(async () => state.counts.sale),
  purchaseCount: vi.fn(async () => state.counts.purchase),
  movementCount: vi.fn(async () => state.counts.movement),
  transactionOptions: null as any,
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any, options: any) => {
      state.transactionOptions = options;
      return callback({
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
        saleItem: { count: state.saleCount },
        purchaseItem: { count: state.purchaseCount },
        stockMovement: { count: state.movementCount },
      });
    },
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
      purchaseRate: "10",
      sellingPrice: "20",
      mrp: null,
      currentStock: { gt: () => false, toString: () => "0" },
    };
    state.counts = { sale: 0, purchase: 0, movement: 0 };
    state.update.mockReset();
    state.update.mockImplementation(async () => ({
      ...state.product,
      unitId: "unit-new",
      unit: {
        id: "unit-new",
        name: "Can",
        symbol: "can",
        allowsDecimals: false,
      },
    }));
    state.saleCount.mockClear();
    state.purchaseCount.mockClear();
    state.movementCount.mockClear();
    state.transactionOptions = null;
  });

  it.each([
    ["sales", "sale"],
    ["purchases", "purchase"],
    ["stock movements", "movement"],
  ] as const)(
    "rejects changing units when %s history exists",
    async (_history, key) => {
      state.counts[key] = 1;
      await expect(
        updateProduct("product-1", { unitId: "unit-new" }),
      ).rejects.toMatchObject({
        statusCode: 409,
        message:
          "The product unit cannot be changed because transaction or stock history exists.",
      });
      expect(state.update).not.toHaveBeenCalled();
      expect(state.saleCount).toHaveBeenCalledWith({
        where: { productId: "product-1" },
      });
      expect(state.purchaseCount).toHaveBeenCalledWith({
        where: { productId: "product-1" },
      });
      expect(state.movementCount).toHaveBeenCalledWith({
        where: { productId: "product-1" },
      });
      expect(state.transactionOptions).toMatchObject({
        isolationLevel: "Serializable",
      });
    },
  );

  it("allows a valid unit change when no transaction or stock history exists", async () => {
    await expect(
      updateProduct("product-1", { unitId: "unit-new" }),
    ).resolves.toMatchObject({
      id: "product-1",
      unitId: "unit-new",
      unitName: "Can",
    });
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "product-1" },
        data: { unitId: "unit-new" },
      }),
    );
    expect(state.saleCount).toHaveBeenCalledOnce();
    expect(state.purchaseCount).toHaveBeenCalledOnce();
    expect(state.movementCount).toHaveBeenCalledOnce();
    expect(state.transactionOptions).toMatchObject({
      isolationLevel: "Serializable",
    });
  });
});
