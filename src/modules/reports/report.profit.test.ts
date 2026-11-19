import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({
  sales: [] as any[],
  expenses: [] as any[],
  dailyPayments: [] as any[],
  purchases: [] as any[],
}));

vi.mock("./report.model.js", () => ({
  reportModel: {
    sales: async () => state.sales,
    expenses: async () => state.expenses,
    dailyPayments: async () => state.dailyPayments,
    purchases: async () => state.purchases,
  },
}));

import {
  dailySales,
  profitReport,
  purchaseReport,
  salesReport,
} from "./report.service.js";

describe("batch-based profit reporting", () => {
  beforeEach(() => {
    state.sales = [
      {
        id: "sale-1",
        invoiceNumber: "AL-261119-001",
        billDate: new Date("2026-11-19T10:00:00Z"),
        subtotal: new Prisma.Decimal("1400"),
        discountAmount: new Prisma.Decimal("100"),
        totalAmount: new Prisma.Decimal("1300"),
        customer: null,
        payments: [],
        items: [
          {
            product: {
              id: "product-1",
              name: "Oil",
              purchaseRate: new Prisma.Decimal("900"),
            },
            quantity: new Prisma.Decimal("2"),
            lineTotal: new Prisma.Decimal("1400"),
            historicalCostSnapshot: new Prisma.Decimal("400"),
            costSnapshotSource: "VERIFIED_BATCH",
            inventoryBatch: { purchaseRate: new Prisma.Decimal("400") },
            unitSellingPrice: new Prisma.Decimal("700"),
          },
        ],
      },
    ];
    state.expenses = [{ amount: new Prisma.Decimal("50") }];
    state.dailyPayments = [];
    state.purchases = [];
  });

  it("uses the sale's batch cost snapshot and reports expenses separately from gross profit", async () => {
    const report = await profitReport(
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    expect(report.invoices[0].items[0]).toMatchObject({
      saleAmount: "1300.00",
      purchaseRate: "400.00",
      cost: "800.00",
      profit: "500.00",
      costBasis: "VERIFIED_BATCH",
    });
    expect(report.totals).toMatchObject({
      netSales: "1300.00",
      totalProfit: "500.00",
      totalExpenses: "50.00",
      finalProfit: "450.00",
    });
  });

  it("marks costs without a verified batch link as legacy estimates", async () => {
    state.sales[0].items[0].historicalCostSnapshot = new Prisma.Decimal("300");
    state.sales[0].items[0].costSnapshotSource = "LEGACY_ESTIMATE";
    state.sales[0].items[0].inventoryBatch = null;
    const report = await profitReport(
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    expect(report.invoices[0].items[0].costBasis).toBe("LEGACY_ESTIMATE");
    expect(report.invoices[0].items[0].purchaseRate).toBe("300.00");
  });

  it("calculates per-batch profit correctly for two batches of the same product", async () => {
    state.sales[0].totalAmount = new Prisma.Decimal("2400");
    state.sales[0].items = [
      {
        product: {
          id: "product-1",
          name: "Oil",
          purchaseRate: new Prisma.Decimal("900"),
        },
        quantity: new Prisma.Decimal("2"),
        lineTotal: new Prisma.Decimal("1000"),
        historicalCostSnapshot: new Prisma.Decimal("400"),
        costSnapshotSource: "VERIFIED_BATCH",
        inventoryBatch: { purchaseRate: new Prisma.Decimal("400") },
      },
      {
        product: {
          id: "product-1",
          name: "Oil",
          purchaseRate: new Prisma.Decimal("900"),
        },
        quantity: new Prisma.Decimal("2"),
        lineTotal: new Prisma.Decimal("1400"),
        historicalCostSnapshot: new Prisma.Decimal("550"),
        costSnapshotSource: "VERIFIED_BATCH",
        inventoryBatch: { purchaseRate: new Prisma.Decimal("550") },
      },
    ];
    state.expenses = [];

    const report = await profitReport(
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    expect(report.invoices[0].items.map((item) => item.profit)).toEqual([
      "200.00",
      "300.00",
    ]);
    expect(report.totals.totalProfit).toBe("500.00");
  });

  it("uses the edited invoice selling price while leaving the batch price as a snapshot", async () => {
    state.sales[0].totalAmount = new Prisma.Decimal("1300");
    state.sales[0].items[0] = {
      product: {
        id: "product-1",
        name: "Oil",
        purchaseRate: new Prisma.Decimal("900"),
      },
      quantity: new Prisma.Decimal("2"),
      lineTotal: new Prisma.Decimal("1300"),
      unitSellingPrice: new Prisma.Decimal("650"),
      historicalCostSnapshot: new Prisma.Decimal("550"),
      batchSellingPriceSnapshot: new Prisma.Decimal("700"),
      costSnapshotSource: "VERIFIED_BATCH",
      inventoryBatch: { purchaseRate: new Prisma.Decimal("550") },
    };
    state.expenses = [];

    const report = await profitReport(
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    expect(report.invoices[0].items[0]).toMatchObject({
      saleAmount: "1300.00",
      purchaseRate: "550.00",
      cost: "1100.00",
      profit: "200.00",
      costBasis: "VERIFIED_BATCH",
    });
  });

  it("keeps daily and sales totals tied to sale records when new purchases are added", async () => {
    const sale = state.sales[0];
    sale.subtotal = new Prisma.Decimal("1000");
    sale.discountAmount = new Prisma.Decimal("0");
    sale.totalAmount = new Prisma.Decimal("1000");
    sale.items[0].product.purchaseRate = new Prisma.Decimal("9000");
    sale.items[0].discountAmount = new Prisma.Decimal("0");
    sale.items[0].unitSellingPrice = new Prisma.Decimal("1000");
    sale.items[0].lineTotal = new Prisma.Decimal("1000");
    sale.items[0].unitNameSnapshot = "Litre";
    sale.items[0].unitSymbolSnapshot = "L";
    state.purchases = [
      {
        purchaseDate: new Date("2026-11-19T11:00:00Z"),
        subtotal: new Prisma.Decimal("6000"),
        discountAmount: new Prisma.Decimal("0"),
        totalAmount: new Prisma.Decimal("6000"),
      },
    ];
    state.dailyPayments = [
      {
        id: "payment-1",
        amount: new Prisma.Decimal("1000"),
        method: "CASH",
        paymentDate: new Date("2026-11-19T10:01:00Z"),
        notes: null,
        sale: {
          id: sale.id,
          invoiceNumber: sale.invoiceNumber,
          billDate: sale.billDate,
          totalAmount: sale.totalAmount,
          discountAmount: sale.discountAmount,
          customer: null,
          items: sale.items.map((item: any) => ({
            ...item,
            product: { id: item.product.id, name: item.product.name },
          })),
        },
      },
    ];

    const sales = await salesReport(
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    const purchases = await purchaseReport(
      new Date("2026-11-01"),
      new Date("2026-11-30"),
    );
    const daily = await dailySales("2026-11-19");

    expect(sales.totals.sales).toBe("1000.00");
    expect(purchases.total).toBe("6000.00");
    expect(daily.totals.collected).toBe("1000.00");
    expect(daily.invoices[0].totalAmount).toBe("1000.00");
  });
});
