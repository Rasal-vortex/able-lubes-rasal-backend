import { describe, expect, it } from "vitest";
import { supplierPaymentSchema } from "./payment.schema.js";

const supplierPayment = {
  supplierId: "03c4891b-2314-4e4a-8774-5add778f1892",
  purchaseId: "0cda9f51-e36d-46e4-8659-f70d8504e119",
};

describe("supplier payment tender validation", () => {
  it("keeps accepting legacy single-method payments", () => {
    expect(
      supplierPaymentSchema.safeParse({
        ...supplierPayment,
        amount: 500,
        method: "CASH",
      }).success,
    ).toBe(true);
  });

  it.each([
    { tenders: [{ method: "CASH", amount: 500 }] },
    { tenders: [{ method: "UPI", amount: 500 }] },
    {
      tenders: [
        { method: "CASH", amount: 200 },
        { method: "UPI", amount: 300 },
      ],
    },
  ])("accepts tender entries $tenders", ({ tenders }) => {
    expect(
      supplierPaymentSchema.safeParse({ ...supplierPayment, tenders }).success,
    ).toBe(true);
  });

  it("rejects duplicate tender methods and mixing legacy fields with tenders", () => {
    expect(
      supplierPaymentSchema.safeParse({
        ...supplierPayment,
        tenders: [
          { method: "CASH", amount: 200 },
          { method: "CASH", amount: 300 },
        ],
      }).success,
    ).toBe(false);
    expect(
      supplierPaymentSchema.safeParse({
        ...supplierPayment,
        amount: 500,
        method: "CASH",
        tenders: [{ method: "UPI", amount: 100 }],
      }).success,
    ).toBe(false);
  });
});
