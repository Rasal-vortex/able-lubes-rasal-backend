import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  productCreate: vi.fn(),
  productFindUniqueOrThrow: vi.fn(),
  batchCreate: vi.fn(),
  movementCreate: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) => callback({
      brand: { findFirst: async () => ({ id: "brand-1" }) },
      unit: {
        findFirst: async () => ({ id: "unit-1" }),
        findUniqueOrThrow: async () => ({ id: "unit-1", name: "Litre", allowsDecimals: true }),
      },
      product: {
        create: state.productCreate,
        findUniqueOrThrow: state.productFindUniqueOrThrow,
      },
      inventoryBatch: { create: state.batchCreate },
      stockMovement: { create: state.movementCreate },
    }),
  },
}));

import { createProduct } from "./product.service.js";

describe("opening inventory batches", () => {
  beforeEach(() => {
    state.productCreate.mockReset();
    state.productFindUniqueOrThrow.mockReset();
    state.batchCreate.mockReset();
    state.movementCreate.mockReset();
    state.productCreate.mockResolvedValue({
      id: "product-1",
      name: "Oil",
      currentStock: "2.5",
      purchaseRate: "400",
      sellingPrice: "500",
      brand: { name: "Brand" },
      unit: { id: "unit-1", name: "Litre", symbol: "L", allowsDecimals: true },
    });
    state.batchCreate.mockResolvedValue({ id: "batch-1" });
    state.movementCreate.mockResolvedValue({});
    state.productFindUniqueOrThrow.mockResolvedValue({
      id: "product-1",
      name: "Oil",
      currentStock: "2.5",
      purchaseRate: "400",
      sellingPrice: "500",
      brand: { name: "Brand" },
      unit: { id: "unit-1", name: "Litre", symbol: "L", allowsDecimals: true },
      inventoryBatches: [],
    });
  });

  it("creates an opening batch and links its stock movement atomically", async () => {
    await createProduct({
      name: "Oil",
      brandId: "brand-1",
      unitId: "unit-1",
      purchaseRate: 400,
      sellingPrice: 500,
      qty: "2.5",
    }, "user-1");

    expect(state.batchCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        productId: "product-1",
        receivedQuantity: "2.5",
        remainingQuantity: "2.5",
        purchaseRate: "400",
        sellingRate: "500",
        source: "OPENING",
        status: "ACTIVE",
      }),
    }));
    expect(state.movementCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inventoryBatchId: "batch-1", quantity: "2.5" }),
    }));
  });
});
