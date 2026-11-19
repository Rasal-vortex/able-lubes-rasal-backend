import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({
  product: null as any,
  batches: [] as any[],
  saleCreate: vi.fn(),
  purchaseCreate: vi.fn(),
  batchCreate: vi.fn(),
  productUpdate: vi.fn(),
  productUpdateMany: vi.fn(),
  batchUpdateMany: vi.fn(),
  purchaseFindUnique: vi.fn(),
  purchaseFindUniqueOrThrow: vi.fn(),
  invoiceCounter: vi.fn(),
  purchaseItemCreate: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) =>
      callback({
        product: {
          findMany: async () => (state.product ? [state.product] : []),
          updateMany: state.productUpdateMany,
          update: state.productUpdate,
        },
        customer: { findFirst: vi.fn() },
        supplier: { findFirst: async () => ({ id: "supplier-1" }) },
        sale: { create: state.saleCreate },
        saleInvoiceCounter: { upsert: state.invoiceCounter },
        purchase: {
          findUnique: state.purchaseFindUnique,
          create: state.purchaseCreate,
          findUniqueOrThrow: state.purchaseFindUniqueOrThrow,
        },
        purchaseItem: { create: state.purchaseItemCreate },
        inventoryBatch: {
          create: state.batchCreate,
          findMany: async ({ where }: any) =>
            state.batches.filter(
              (batch) =>
                where.id.in.includes(batch.id) &&
                batch.status === where.status &&
                Number(batch.remainingQuantity) > 0,
            ),
          updateMany: state.batchUpdateMany,
        },
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
    state.batches = [
      {
        id: "batch-1",
        productId: "product-1",
        status: "ACTIVE",
        remainingQuantity: new Prisma.Decimal("5"),
        purchaseRate: new Prisma.Decimal("4"),
        sellingRate: new Prisma.Decimal("10"),
      },
    ];
    state.saleCreate.mockReset();
    state.purchaseCreate.mockReset();
    state.batchCreate.mockReset();
    state.productUpdate.mockReset();
    state.productUpdateMany.mockReset();
    state.batchUpdateMany.mockReset();
    state.batchUpdateMany.mockImplementation(async ({ where, data }: any) => {
      const batch = state.batches.find((entry) => entry.id === where.id);
      if (
        !batch ||
        Number(batch.remainingQuantity) < Number(where.remainingQuantity.gte)
      )
        return { count: 0 };
      batch.remainingQuantity = batch.remainingQuantity.minus(
        data.remainingQuantity.decrement,
      );
      if (data.status) batch.status = data.status;
      return { count: 1 };
    });
    state.productUpdateMany.mockResolvedValue({ count: 1 });
    state.purchaseFindUnique.mockResolvedValue(null);
    state.purchaseFindUniqueOrThrow.mockReset();
    state.purchaseItemCreate.mockImplementation(async ({ data }: any) => ({
      id: `item-${state.purchaseItemCreate.mock.calls.length}`,
      ...data,
    }));
    state.invoiceCounter.mockResolvedValue({ lastSequence: 1 });
  });

  it("rejects fractional sales using the product unit", async () => {
    await expect(
      createSale({
        items: [
          {
            productId: "product-1",
            inventoryBatchId: "batch-1",
            quantity: "1.5",
            discountAmount: 0,
          },
        ],
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
        idempotencyKey: "9d79c460-66ba-40a0-bec6-e39e953bab11",
        items: [
          {
            productId: "product-1",
            quantity: "1.5",
            supplierRate: 2,
            sellingRate: 3,
          },
        ],
        discountAmount: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Bottle quantities must be whole numbers",
    });
    expect(state.purchaseCreate).not.toHaveBeenCalled();
  });

  it("creates one independently priced batch per purchase line and increments aggregate stock", async () => {
    const p = {
      ...state.product,
      unit: { ...state.product.unit, name: "Litre", allowsDecimals: true },
    };
    state.product = p;
    state.purchaseCreate.mockResolvedValue({ id: "purchase-1" });
    state.batchCreate.mockResolvedValue({});
    state.productUpdate.mockResolvedValue({});
    const created = { id: "purchase-1", items: [] };
    state.purchaseFindUniqueOrThrow.mockResolvedValue(created as any);
    await createPurchase({
      idempotencyKey: "9d79c460-66ba-40a0-bec6-e39e953bab11",
      supplierId: "supplier-1",
      discountAmount: 0,
      items: [
        { productId: p.id, quantity: 10, supplierRate: 400, sellingRate: 500 },
        { productId: p.id, quantity: 10, supplierRate: 550, sellingRate: 700 },
      ],
    });
    expect(state.batchCreate).toHaveBeenCalledTimes(2);
    expect(state.batchCreate.mock.calls.map((call) => call[0].data)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          purchaseRate: expect.anything(),
          sellingRate: expect.anything(),
          receivedQuantity: expect.anything(),
          remainingQuantity: expect.anything(),
          purchaseItemId: "item-1",
        }),
        expect.objectContaining({ purchaseItemId: "item-2" }),
      ]),
    );
    expect(
      state.batchCreate.mock.calls.map(([args]: any[]) => [
        args.data.purchaseRate.toString(),
        args.data.sellingRate.toString(),
        args.data.receivedQuantity.toString(),
        args.data.remainingQuantity.toString(),
      ]),
    ).toEqual([
      ["400", "500", "10", "10"],
      ["550", "700", "10", "10"],
    ]);
    expect(state.productUpdate).toHaveBeenCalledTimes(2);
  });

  it("returns the prior purchase for a repeated idempotency key without creating another batch", async () => {
    const prior = { id: "purchase-existing", items: [] };
    state.purchaseFindUnique.mockResolvedValue(prior);
    await expect(
      createPurchase({
        idempotencyKey: "9d79c460-66ba-40a0-bec6-e39e953bab11",
        supplierId: "supplier-1",
        items: [
          {
            productId: "product-1",
            quantity: 1,
            supplierRate: 400,
            sellingRate: 500,
          },
        ],
      }),
    ).resolves.toBe(prior);
    expect(state.purchaseCreate).not.toHaveBeenCalled();
    expect(state.batchCreate).not.toHaveBeenCalled();
  });

  it("uses the selected batch cost and selling-price snapshot while preserving an invoice price override", async () => {
    const batch = state.batches[0];
    state.saleCreate.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: "sale-1",
    }));
    await createSale({
      items: [
        {
          productId: "product-1",
          inventoryBatchId: batch.id,
          quantity: 2,
          unitSellingPrice: 8,
          discountAmount: 0,
        },
      ],
      discountAmount: 0,
    });
    const saleLine = state.saleCreate.mock.calls[0][0].data.items.create[0];
    expect(saleLine.inventoryBatchId).toBe("batch-1");
    expect(saleLine.historicalCostSnapshot.toString()).toBe("4");
    expect(saleLine.batchSellingPriceSnapshot.toString()).toBe("10");
    expect(saleLine.unitSellingPrice.toString()).toBe("8");
    expect(state.batchUpdateMany).toHaveBeenCalledTimes(1);
    expect(state.productUpdateMany).toHaveBeenCalledTimes(1);

    await createSale({
      items: [
        {
          productId: "product-1",
          inventoryBatchId: batch.id,
          quantity: 1,
          discountAmount: 0,
        },
      ],
      discountAmount: 0,
    });
    const nextSaleLine = state.saleCreate.mock.calls[1][0].data.items.create[0];
    expect(nextSaleLine.unitSellingPrice.toString()).toBe("10");
    expect(batch.sellingRate.toString()).toBe("10");
  });

  it("keeps same-product lines separate when they come from different batches", async () => {
    state.product.currentStock = "20.000";
    state.batches = [
      {
        id: "batch-1",
        productId: "product-1",
        status: "ACTIVE",
        remainingQuantity: new Prisma.Decimal("10"),
        purchaseRate: new Prisma.Decimal("400"),
        sellingRate: new Prisma.Decimal("500"),
      },
      {
        id: "batch-2",
        productId: "product-1",
        status: "ACTIVE",
        remainingQuantity: new Prisma.Decimal("10"),
        purchaseRate: new Prisma.Decimal("550"),
        sellingRate: new Prisma.Decimal("700"),
      },
    ];
    state.saleCreate.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: "sale-1",
    }));
    await createSale({
      items: [
        {
          productId: "product-1",
          inventoryBatchId: "batch-1",
          quantity: 2,
          unitSellingPrice: 500,
          discountAmount: 0,
        },
        {
          productId: "product-1",
          inventoryBatchId: "batch-2",
          quantity: 2,
          unitSellingPrice: 700,
          discountAmount: 0,
        },
      ],
      discountAmount: 0,
    });
    const lines = state.saleCreate.mock.calls[0][0].data.items.create;
    expect(lines).toHaveLength(2);
    expect(lines.map((line: any) => line.inventoryBatchId)).toEqual([
      "batch-1",
      "batch-2",
    ]);
    expect(
      state.batches.map((batch) => batch.remainingQuantity.toString()),
    ).toEqual(["8", "8"]);
    expect(
      lines.map((line: any) => line.historicalCostSnapshot.toString()),
    ).toEqual(["400", "550"]);
    expect(state.batchUpdateMany).toHaveBeenCalledTimes(2);
    expect(state.productUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects quantities beyond the selected batch without decrementing stock or creating a sale", async () => {
    await expect(
      createSale({
        items: [
          {
            productId: "product-1",
            inventoryBatchId: "batch-1",
            quantity: 6,
            unitSellingPrice: 10,
            discountAmount: 0,
          },
        ],
        discountAmount: 0,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(state.batchUpdateMany).not.toHaveBeenCalled();
    expect(state.productUpdateMany).not.toHaveBeenCalled();
    expect(state.saleCreate).not.toHaveBeenCalled();
  });
});
