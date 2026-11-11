import { ApiError } from "../../shared/errors.js";
import { pageMeta } from "../../shared/pagination.js";
import { expenseModel } from "./expense.model.js";
import { expenseSerializer } from "./expense.serializer.js";
export async function listExpenses(q: any) {
  const where: any = {
    ...(q.search
      ? {
          OR: [
            { description: { contains: q.search, mode: "insensitive" } },
            { category: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(q.from || q.to
      ? {
          expenseDate: {
            ...(q.from ? { gte: q.from } : {}),
            ...(q.to ? { lte: q.to } : {}),
          },
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    expenseModel.list(where, (q.page - 1) * q.limit, q.limit),
    expenseModel.count(where),
  ]);
  return {
    data: data.map(expenseSerializer),
    meta: pageMeta(q.page, q.limit, total),
  };
}
export async function createExpense(data: any) {
  return expenseSerializer(
    await expenseModel.create({
      ...data,
      description: typeof data.description === "string" ? data.description.trim() : "",
      expenseDate: data.expenseDate ?? new Date(),
    }),
  );
}
export async function updateExpense(id: string, data: any) {
  if (!(await expenseModel.get(id)))
    throw new ApiError(404, "Expense not found");
  return expenseSerializer(await expenseModel.update(id, data));
}
