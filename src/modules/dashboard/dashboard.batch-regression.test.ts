import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({ now: new Date() }));
const money = (value: number) => new Prisma.Decimal(value);

vi.mock("../../config/env.js", () => ({ env: { BUSINESS_TIME_ZONE: "UTC" } }));
vi.mock("../../config/prisma.js", () => ({ prisma: {} }));
vi.mock("../reports/report.model.js", () => ({
  reportModel: {
    customerSales: async () => [
      {
        customerId: "customer-1",
        totalAmount: money(1000),
        customer: { id: "customer-1", name: "Customer", phone: null },
        payments: [{ amount: money(700) }],
      },
    ],
    supplierPurchases: async () => [
      {
        supplierId: "supplier-1",
        totalAmount: money(6000),
        supplier: { id: "supplier-1", name: "Supplier", phone: null },
        payments: [],
      },
    ],
  },
}));
vi.mock("./dashboard.model.js", () => ({
  dashboardModel: {
    todaySales: async () => ({ _sum: { totalAmount: money(1000) } }),
    todayExpenses: async () => ({ _sum: { amount: money(50) } }),
    todayPayments: async () => ({ _sum: { amount: money(700) } }),
    monthSales: async () => 1,
    chartSales: async () => [
      {
        billDate: state.now,
        totalAmount: money(1000),
        payments: [{ amount: money(700) }],
      },
    ],
    latestSales: async () => [
      {
        invoiceNumber: "AL-261119-001",
        customer: { name: "Customer" },
        totalAmount: money(1000),
        billDate: state.now,
        payments: [{ method: "CASH" }],
      },
    ],
  },
}));

import { dashboardSummary } from "./dashboard.service.js";

describe("dashboard batch inventory regression", () => {
  it("keeps sales totals based on sales while purchase balances remain separate", async () => {
    state.now = new Date();
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
    }).format(state.now);
    const summary = await dashboardSummary(date);

    expect(summary.today.salesTotal).toBe("1000.00");
    expect(summary.today.expensesTotal).toBe("50.00");
    expect(summary.today.paymentsCollected).toBe("700.00");
    expect(summary.balances.customerOutstanding).toBe("300.00");
    expect(summary.balances.supplierPayable).toBe("6000.00");
    expect(
      summary.chart.days.reduce(
        (total, day) => total + Number(day.paidSales) + Number(day.creditSales),
        0,
      ),
    ).toBe(1000);
  });
});
