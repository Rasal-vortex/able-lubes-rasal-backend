export function toExcelValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (
      "toNumber" in value &&
      typeof (value as { toNumber?: unknown }).toNumber === "function"
    )
      return value.toString();
    return JSON.stringify(value);
  }
  return String(value);
}

export function safeWorksheetName(name: string, usedNames: Set<string>) {
  const base = name.replace(/[\\/*?:\[\]]/g, "_").slice(0, 31) || "Sheet";
  let candidate = base;
  let suffix = 1;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    const marker = `_${suffix++}`;
    candidate = `${base.slice(0, 31 - marker.length)}${marker}`;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function exportFilename(date = new Date()) {
  return `database-export-${date.toISOString().slice(0, 10)}.xlsx`;
}
