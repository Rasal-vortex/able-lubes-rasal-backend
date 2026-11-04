import { describe, expect, it } from "vitest";
import { validateQuantity } from "./quantity.js";
import { createPurchaseSchema } from "../modules/purchases/purchase.schema.js";
import { createSaleSchema } from "../modules/sales/sale.schema.js";
import { adjustmentSchema } from "../modules/stock/stock.schema.js";
import { createProductSchema } from "../modules/products/product.schema.js";

const integerUnit = { name: "Bottle", allowsDecimals: false };
const decimalUnit = { name: "Litre", allowsDecimals: true };

describe("unit-aware quantity validation", () => {
  it("accepts whole quantities for integer-only units and rejects fractions", () => {
    expect(() => validateQuantity(5, integerUnit)).not.toThrow();
    expect(() => validateQuantity(2.5, integerUnit)).toThrow(/whole numbers/);
  });

  it("accepts up to three decimal places for decimal-enabled units", () => {
    expect(() => validateQuantity(2, decimalUnit)).not.toThrow();
    expect(() => validateQuantity("2.500", decimalUnit)).not.toThrow();
    expect(() => validateQuantity("2.5555", decimalUnit)).toThrow(
      /three decimal places/,
    );
  });

  it("checks purchase and sale request quantities by preserving decimal input", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const purchase = createPurchaseSchema.parse({
      supplierId: id,
      items: [{ productId: id, quantity: "1.250", supplierRate: 2 }],
    });
    const sale = createSaleSchema.parse({
      items: [{ productId: id, quantity: "1.250" }],
    });
    expect(purchase.items[0].quantity).toBe("1.250");
    expect(sale.items[0].quantity).toBe("1.250");
    expect(() =>
      validateQuantity(purchase.items[0].quantity, integerUnit),
    ).toThrow(/whole numbers/);
    expect(() =>
      validateQuantity(sale.items[0].quantity, decimalUnit),
    ).not.toThrow();
  });

  it("preserves exact adjustment precision for service validation", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      adjustmentSchema.parse({
        productId: id,
        quantity: "2.5555",
        direction: "IN",
        reason: "Count",
      }).quantity,
    ).toBe("2.5555");
    expect(() => validateQuantity("2.5", integerUnit)).toThrow(/whole numbers/);
  });

  it("validates opening stock against the selected product unit", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const product = createProductSchema.parse({
      name: "Oil",
      brandId: id,
      unitId: id,
      sellingPrice: 10,
      qty: "1.2345",
    });
    expect(() => validateQuantity(product.qty, decimalUnit)).toThrow(
      /three decimal places/,
    );
  });
});
