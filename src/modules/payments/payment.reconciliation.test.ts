import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "../../../generated/prisma/client.js";

const state = vi.hoisted(() => ({
  paid: null as any,
  create: vi.fn(),
  setStatus: vi.fn(),
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: { $transaction: (callback: any) => callback({}) },
}));

vi.mock("./payment.model.js", () => ({
  paymentModel: {
    sale: async () => ({
      id: "sale-1",
      status: "POSTED",
      customerId: "customer-1",
      totalAmount: new Prisma.Decimal("1000"),
    }),
    salePayments: async () => ({ _sum: { amount: state.paid } }),
    createCustomerPayment: async ({
      amount,
      method,
      customerId,
      notes,
    }: any) => {
      state.paid = (state.paid ?? new Prisma.Decimal(0)).add(amount);
      const row = {
        id: `payment-${state.create.mock.calls.length + 1}`,
        amount,
        method,
        customerId,
        notes,
      };
      state.create(row);
      return row;
    },
    setSalePaymentStatus: state.setStatus,
  },
}));

import { recordCustomerPayment } from "./payment.service.js";

describe("customer tender reconciliation for batch sales", () => {
  beforeEach(() => {
    state.paid = new Prisma.Decimal(0);
    state.create.mockReset();
    state.setStatus.mockReset();
  });

  it.each([
    ["CASH", 1000],
    ["UPI", 1000],
  ] as const)(
    "reconciles a full %s payment to the invoice",
    async (method, amount) => {
      await recordCustomerPayment({ saleId: "sale-1", amount, method });
      expect(state.paid.toFixed(2)).toBe("1000.00");
      expect(state.setStatus).toHaveBeenCalledWith(
        "sale-1",
        "PAID",
        expect.anything(),
      );
    },
  );

  it("reconciles cash, UPI and code-less coupon tenders in split mode", async () => {
    await recordCustomerPayment({
      saleId: "sale-1",
      amount: 400,
      method: "CASH",
    });
    await recordCustomerPayment({
      saleId: "sale-1",
      amount: 350,
      method: "UPI",
    });
    await recordCustomerPayment({
      saleId: "sale-1",
      amount: 250,
      method: "COUPON",
    });

    expect(state.paid.toFixed(2)).toBe("1000.00");
    expect(
      state.create.mock.calls.map(([payment]: any[]) => [
        payment.method,
        payment.amount.toFixed(2),
      ]),
    ).toEqual([
      ["CASH", "400.00"],
      ["UPI", "350.00"],
      ["COUPON", "250.00"],
    ]);
    expect(state.create.mock.calls[2][0].notes).toBe(
      "Coupon payment (no code)",
    );
    expect(state.setStatus).toHaveBeenLastCalledWith(
      "sale-1",
      "PAID",
      expect.anything(),
    );
  });

  it("rejects a tender that would exceed the remaining invoice balance", async () => {
    state.paid = new Prisma.Decimal("900");
    await expect(
      recordCustomerPayment({ saleId: "sale-1", amount: 101, method: "CASH" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Payment exceeds the invoice outstanding amount",
    });
    expect(state.create).not.toHaveBeenCalled();
  });
});
