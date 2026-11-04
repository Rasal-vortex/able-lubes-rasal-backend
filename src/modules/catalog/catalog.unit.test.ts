import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string;
    name: string;
    symbol: string | null;
    allowsDecimals: boolean;
    active: boolean;
  }>,
  nextId: 1,
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    unit: {
      findMany: vi.fn(async () => state.rows),
      findUnique: vi.fn(
        async ({ where }: any) =>
          state.rows.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `u${state.nextId++}`, active: true, ...data };
        state.rows.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.rows.find((entry) => entry.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
  },
}));

import { create, get, update } from "./catalog.service.js";
import { unitSchema } from "./catalog.schema.js";

describe("unit catalog CRUD", () => {
  beforeEach(() => {
    state.rows.length = 0;
    state.nextId = 1;
  });

  it("creates and retrieves a unit with a nullable symbol", async () => {
    const input = unitSchema.parse({ name: "Bottle", symbol: null });
    const created = await create("unit", input);
    expect(created).toMatchObject({
      name: "Bottle",
      symbol: null,
      allowsDecimals: false,
    });
    expect(await get("unit", created.id)).toEqual(created);
  });

  it("allows shared symbols and updates a unit", async () => {
    const one = await create("unit", {
      name: "Bottle",
      symbol: "u",
      allowsDecimals: false,
    });
    await create("unit", { name: "Can", symbol: "u", allowsDecimals: false });
    const changed = await update("unit", one.id, {
      name: "Pouch",
      allowsDecimals: true,
    });
    expect(changed).toMatchObject({
      name: "Pouch",
      symbol: "u",
      allowsDecimals: true,
    });
  });

  it("rejects case and whitespace normalized duplicates", async () => {
    await create("unit", {
      name: "  Litre ",
      symbol: "L",
      allowsDecimals: true,
    });
    await expect(
      create("unit", { name: "litre", symbol: "l", allowsDecimals: true }),
    ).rejects.toMatchObject({ statusCode: 409 });
    const can = await create("unit", {
      name: "Can",
      symbol: "can",
      allowsDecimals: false,
    });
    await expect(
      update("unit", can.id, { name: " LITRE " }),
    ).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("rejects symbols longer than five characters", () => {
    expect(
      unitSchema.safeParse({ name: "Litre", symbol: "litres" }).success,
    ).toBe(false);
  });
});
