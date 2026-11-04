import { describe, expect, it, vi } from "vitest";
import { seedCanonicalUnits } from "./unit-catalog.js";

describe("canonical unit seeding", () => {
  it("matches trimmed case-insensitive names, updates canonical values, and is idempotent", async () => {
    const rows: Array<{
      id: string;
      name: string;
      symbol?: string | null;
      allowsDecimals?: boolean;
    }> = [
      { id: "u1", name: "  lItRe ", symbol: "old", allowsDecimals: false },
      { id: "u2", name: "Custom Case", symbol: null, allowsDecimals: false },
    ];
    const client = {
      unit: {
        findMany: vi.fn(async () => rows.map(({ id, name }) => ({ id, name }))),
        update: vi.fn(async ({ where, data }: any) => {
          const row = rows.find((unit) => unit.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `u${rows.length + 1}`, ...data };
          rows.push(row);
          return row;
        }),
      },
    };

    await seedCanonicalUnits(client);
    expect(rows.find((row) => row.id === "u1")).toMatchObject({
      name: "Litre",
      symbol: "L",
      allowsDecimals: true,
    });
    expect(rows.find((row) => row.id === "u2")).toBeDefined();
    const countAfterFirstRun = rows.length;
    await seedCanonicalUnits(client);
    expect(rows).toHaveLength(countAfterFirstRun);
    expect(client.unit.create).toHaveBeenCalledTimes(8);
  });

  it("stops before writing when normalized existing names collide", async () => {
    const client = {
      unit: {
        findMany: async () => [
          { id: "u1", name: "Bottle" },
          { id: "u2", name: " bottle " },
        ],
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    await expect(seedCanonicalUnits(client)).rejects.toThrow(/collisions/);
    expect(client.unit.update).not.toHaveBeenCalled();
    expect(client.unit.create).not.toHaveBeenCalled();
  });

  it("stops before seeding when an existing name may be a canonical symbol alias", async () => {
    const client = {
      unit: {
        findMany: async () => [{ id: "u1", name: "L" }],
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    await expect(seedCanonicalUnits(client)).rejects.toThrow(
      /aliases need review/,
    );
    expect(client.unit.update).not.toHaveBeenCalled();
    expect(client.unit.create).not.toHaveBeenCalled();
  });
});
