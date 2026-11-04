import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../src/config/prisma.js";

const canonical = [
  { name: "Bottle", symbol: "btl" },
  { name: "Can", symbol: "can" },
  { name: "Pouch", symbol: "pch" },
  { name: "Drum", symbol: "drm" },
  { name: "Bucket", symbol: "bkt" },
  { name: "Piece", symbol: "pc" },
  { name: "Box", symbol: "box" },
  { name: "Litre", symbol: "L" },
  { name: "Kilogram", symbol: "kg" },
];
const normalize = (value: string) => value.trim().toLowerCase();

try {
  // Query the pre-migration schema directly so this report works before the
  // new allows_decimals column exists.
  const rows = await prisma.$queryRaw<
    Array<{
      unitId: string;
      unitName: string;
      unitSymbol: string | null;
      unitActive: boolean;
      productId: string | null;
      productName: string | null;
      historicalSales: number;
      historicalPurchases: number;
      stockMovements: number;
    }>
  >`
    SELECT u.id::text AS "unitId", u.name AS "unitName", u.symbol AS "unitSymbol",
      u.active AS "unitActive", p.id::text AS "productId", p.name AS "productName",
      COUNT(DISTINCT si.id)::int AS "historicalSales",
      COUNT(DISTINCT pi.id)::int AS "historicalPurchases",
      COUNT(DISTINCT sm.id)::int AS "stockMovements"
    FROM units u
    LEFT JOIN products p ON p.unit_id = u.id
    LEFT JOIN sale_items si ON si.product_id = p.id
    LEFT JOIN purchase_items pi ON pi.product_id = p.id
    LEFT JOIN stock_movements sm ON sm.product_id = p.id
    GROUP BY u.id, p.id
    ORDER BY u.name, p.name
  `;
  const units = new Map<string, (typeof rows)[number][]>();
  for (const row of rows)
    units.set(row.unitId, [...(units.get(row.unitId) ?? []), row]);
  const normalizedCounts = new Map<string, number>();
  for (const unitRows of units.values()) {
    const key = normalize(unitRows[0].unitName);
    normalizedCounts.set(key, (normalizedCounts.get(key) ?? 0) + 1);
  }
  const report = [...units.values()].map((unitRows) => {
    const unit = unitRows[0];
    const targets = canonical.filter(
      (candidate) => normalize(candidate.name) === normalize(unit.unitName),
    );
    const symbolAliases = canonical.filter(
      (candidate) => normalize(candidate.symbol) === normalize(unit.unitName),
    );
    return {
      oldUnit: {
        id: unit.unitId,
        name: unit.unitName,
        symbol: unit.unitSymbol,
        active: unit.unitActive,
      },
      proposedCanonicalUnit: targets.length === 1 ? targets[0].name : null,
      possibleSymbolAliasMatches: symbolAliases.map(
        (candidate) => candidate.name,
      ),
      mappingStatus:
        (normalizedCounts.get(normalize(unit.unitName)) ?? 0) > 1
          ? "AMBIGUOUS_NORMALIZED_NAME_COLLISION"
          : targets.length === 1
            ? "MATCH_CANONICAL_NAME"
            : symbolAliases.length
              ? "POSSIBLE_SYMBOL_ALIAS_REQUIRES_REVIEW"
              : "KEEP_EXISTING_REVIEW_IF_RENAMING",
      products: unitRows
        .filter((row) => row.productId)
        .map((row) => ({
          id: row.productId,
          name: row.productName,
          historicalSales: row.historicalSales,
          historicalPurchases: row.historicalPurchases,
          stockMovements: row.stockMovements,
        })),
    };
  });
  const document = { mode: "READ_ONLY", mapping: report };
  const reportPath = resolve(
    process.cwd(),
    "output",
    "unit-mapping-report.json",
  );
  await writeFile(reportPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`Read-only mapping report written to ${reportPath}`);
  console.log(JSON.stringify(document, null, 2));
} finally {
  await prisma.$disconnect();
}
