export const canonicalUnits = [
  { name: "Bottle", symbol: "btl", allowsDecimals: false },
  { name: "Can", symbol: "can", allowsDecimals: false },
  { name: "Pouch", symbol: "pch", allowsDecimals: false },
  { name: "Drum", symbol: "drm", allowsDecimals: false },
  { name: "Bucket", symbol: "bkt", allowsDecimals: false },
  { name: "Piece", symbol: "pc", allowsDecimals: false },
  { name: "Box", symbol: "box", allowsDecimals: false },
  { name: "Litre", symbol: "L", allowsDecimals: true },
  { name: "Kilogram", symbol: "kg", allowsDecimals: true },
] as const;

const normalizeName = (name: string) => name.trim().toLowerCase();

export async function seedCanonicalUnits(client: { unit: any }) {
  const existingUnits = (await client.unit.findMany()) as Array<{
    id: string;
    name: string;
  }>;

  const canonicalByName = new Map(
    canonicalUnits.map((unit) => [normalizeName(unit.name), unit]),
  );

  const canonicalBySymbol = new Map(
    canonicalUnits.map((unit) => [normalizeName(unit.symbol), unit]),
  );

  const groups = new Map<string, typeof existingUnits>();

  for (const existing of existingUnits) {
    const key = normalizeName(existing.name);

    groups.set(key, [...(groups.get(key) ?? []), existing]);
  }

  // Prevent duplicate normalized names.
  const collisions = [...groups.entries()].filter(
    ([, rows]) => rows.length > 1,
  );

  if (collisions.length) {
    throw new Error(
      `Normalized unit name collisions must be reviewed: ${collisions
        .map(
          ([name, rows]) => `${name} (${rows.map((row) => row.id).join(", ")})`,
        )
        .join("; ")}`,
    );
  }

  // A unit name that matches a canonical symbol may represent a referenced
  // custom unit. Require manual review before any unit rows are changed.
  const aliases = existingUnits.filter((existing) => {
    const key = normalizeName(existing.name);
    return canonicalBySymbol.has(key) && !canonicalByName.has(key);
  });

  if (aliases.length) {
    throw new Error(
      `Canonical unit symbol aliases need review before seeding: ${aliases
        .map((unit) => `"${unit.name}" (${unit.id})`)
        .join(", ")}`,
    );
  }

  const refreshedGroups = new Map(
    existingUnits.map((unit) => [normalizeName(unit.name), unit]),
  );

  // Create missing units or update existing canonical units.
  for (const unit of canonicalUnits) {
    const match = refreshedGroups.get(normalizeName(unit.name));

    if (match) {
      await client.unit.update({
        where: { id: match.id },
        data: { ...unit },
      });
    } else {
      await client.unit.create({
        data: { ...unit },
      });
    }
  }

  console.log("Canonical units seeded successfully.");
}
