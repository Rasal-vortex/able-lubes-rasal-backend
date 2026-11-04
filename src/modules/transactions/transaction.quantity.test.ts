import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  product: null as any,
  saleCreate: vi.fn(),
  purchaseCreate: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) =>
      callback({
        product: {
          findMany: async () => (state.product ? [state.product] : []),
          updateMany: vi.fn(),
          update: vi.fn(),
        },
        customer: { findFirst: vi.fn() },
        supplier: { findFirst: async () => ({ id: "supplier-1" }) },
        sale: { create: state.saleCreate },
        purchase: { create: state.purchaseCreate },
      }),
  },
}));

import { createPurchase, createSale } from "./transaction.service.js";

describe("purchase and sales quantity enforcement", () => {
  beforeEach(() => {
    state.product = {
      id: "product-1",
      name: "Bottle product",
      active: true,
      unit: { id: "unit-1", name: "Bottle", allowsDecimals: false },
      sellingPrice: "10.00",
      currentStock: "5.000",
    };
    state.saleCreate.mockReset();
    state.purchaseCreate.mockReset();
  });

  it("rejects fractional sales using the product unit", async () => {
    await expect(
      createSale({
        items: [{ productId: "product-1", quantity: "1.5", discountAmount: 0 }],
        discountAmount: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Bottle quantities must be whole numbers",
    });
    expect(state.saleCreate).not.toHaveBeenCalled();
  });

  it("rejects fractional purchases using the product unit", async () => {
    await expect(
      createPurchase({
        supplierId: "supplier-1",
        items: [{ productId: "product-1", quantity: "1.5", supplierRate: 2 }],
        discountAmount: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Bottle quantities must be whole numbers",
    });
    expect(state.purchaseCreate).not.toHaveBeenCalled();
  });
});
