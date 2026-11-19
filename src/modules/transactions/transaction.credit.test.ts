import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({
  saleCreate: vi.fn(),
  creditBillCreate: vi.fn(),
  batchUpdateMany: vi.fn(),
  productUpdateMany: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    $transaction: (callback: any) =>
      callback({
        saleInvoiceCounter: { upsert: async () => ({ lastSequence: 1 }) },
        product: {
          findMany: async () => [
            {
              id: "product-1",
              name: "Oil",
              active: true,
              unit: { name: "Litre", symbol: "L", allowsDecimals: true },
            },
          ],
          updateMany: state.productUpdateMany,
        },
        inventoryBatch: {
          findMany: async () => [
            {
              id: "batch-1",
              productId: "product-1",
              status: "ACTIVE",
              remainingQuantity: new Prisma.Decimal("10"),
              purchaseRate: new Prisma.Decimal("400"),
              sellingRate: new Prisma.Decimal("500"),
            },
          ],
          updateMany: state.batchUpdateMany,
        },
        customer: { findFirst: async () => ({ id: "customer-1" }) },
        sale: { create: state.saleCreate },
        customerCreditBill: { create: state.creditBillCreate },
      }),
  },
}));

import { createSale } from "./transaction.service.js";

describe("credit sale reconciliation", () => {
  beforeEach(() => {
    state.saleCreate.mockReset().mockImplementation(async ({ data }: any) => ({
      id: "sale-credit",
      ...data,
    }));
    state.creditBillCreate
      .mockReset()
      .mockImplementation(async ({ data }: any) => ({
        id: "credit-1",
        ...data,
      }));
    state.batchUpdateMany.mockReset().mockResolvedValue({ count: 1 });
    state.productUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("records a full-value credit bill without creating a paid tender", async () => {
    const sale = await createSale({
      customerId: "customer-1",
      billDate: new Date("2026-11-19T10:00:00Z"),
      discountAmount: 0,
      items: [
        {
          productId: "product-1",
          inventoryBatchId: "batch-1",
          quantity: 2,
          unitSellingPrice: 500,
          discountAmount: 0,
        },
      ],
      creditBill: {
        billNumber: "CR-AL-261119-001",
        dueDate: new Date("2026-11-30T00:00:00Z"),
        term: "Due on agreed date",
      },
    });

    expect(sale.paymentStatus).toBe("UNPAID");
    expect(state.saleCreate.mock.calls[0][0].data.totalAmount.toFixed(2)).toBe(
      "1000.00",
    );
    expect(
      state.creditBillCreate.mock.calls[0][0].data.billAmount.toFixed(2),
    ).toBe("1000.00");
    expect(state.creditBillCreate.mock.calls[0][0].data.saleId).toBe(
      "sale-credit",
    );
  });
});
