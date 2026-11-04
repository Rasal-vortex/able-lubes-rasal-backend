import { prisma } from "../../config/prisma.js";
import { ApiError } from "../../shared/errors.js";
import { pageMeta } from "../../shared/pagination.js";
import { Prisma } from "../../../generated/prisma/client.js";

const model = (kind: "brand" | "unit") => (prisma as any)[kind];
const normalizeUnitName = (name: string) => name.trim().toLowerCase();
export async function list(kind: "brand" | "unit", q: any) {
  const where = {
    ...(q.active === undefined ? {} : { active: q.active }),
    ...(q.search ? { name: { contains: q.search, mode: "insensitive" } } : {}),
  };
  const [data, total] = await Promise.all([
    model(kind).findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { name: "asc" },
    }),
    model(kind).count({ where }),
  ]);
  return { data, meta: pageMeta(q.page, q.limit, total) };
}
export async function get(kind: "brand" | "unit", id: string) {
  const row = await model(kind).findUnique({ where: { id } });
  if (!row)
    throw new ApiError(404, `${kind === "brand" ? "Brand" : "Unit"} not found`);
  return row;
}
export async function create(kind: "brand" | "unit", data: any) {
  if (kind === "unit") {
    const existing = await prisma.unit.findMany({
      select: { id: true, name: true },
    });
    const duplicate = existing.find(
      (row) => normalizeUnitName(row.name) === normalizeUnitName(data.name),
    );
    if (duplicate)
      throw new ApiError(409, "A unit with this name already exists");
    try {
      return await prisma.unit.create({
        data: { ...data, name: data.name.trim() },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ApiError(409, "A unit with this name already exists");
      throw error;
    }
  }
  return model(kind).create({ data });
}
export async function update(kind: "brand" | "unit", id: string, data: any) {
  await get(kind, id);
  if (kind === "unit") {
    const normalized = {
      ...data,
      ...(data.name ? { name: data.name.trim() } : {}),
    };
    if (normalized.name) {
      const existing = await prisma.unit.findMany({
        select: { id: true, name: true },
      });
      const duplicate = existing.find(
        (row) =>
          row.id !== id &&
          normalizeUnitName(row.name) === normalizeUnitName(normalized.name),
      );
      if (duplicate)
        throw new ApiError(409, "A unit with this name already exists");
    }
    try {
      return await prisma.unit.update({ where: { id }, data: normalized });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new ApiError(409, "A unit with this name already exists");
      throw error;
    }
  }
  return model(kind).update({ where: { id }, data });
}
