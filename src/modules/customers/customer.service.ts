import { ApiError } from "../../shared/errors.js";
import { pageMeta } from "../../shared/pagination.js";
import { customerModel } from "./customer.model.js";
import { customerSerializer } from "./customer.serializer.js";
export async function listCustomers(q: any) {
  const where = {
    active: q.active,
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { phone: { contains: q.search } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    customerModel.list(where, (q.page - 1) * q.limit, q.limit),
    customerModel.count(where),
  ]);
  const creditTotals = await customerModel.storeCreditTotals(data.map((row: any) => row.id));
  const creditByCustomer = new Map<string, number>();
  for (const row of creditTotals as any[]) creditByCustomer.set(row.customerId, (creditByCustomer.get(row.customerId) ?? 0) + (row.type === "CREDIT" ? Number(row._sum.amount || 0) : -Number(row._sum.amount || 0)));
  return {
    data: data.map((customer: any) => ({ ...customerSerializer(customer), availableStoreCredit: Math.max(0, creditByCustomer.get(customer.id) ?? 0).toFixed(2) })),
    meta: pageMeta(q.page, q.limit, total),
  };
}
export async function getCustomer(id: string) {
  const x = await customerModel.get(id);
  if (!x) throw new ApiError(404, "Customer not found");
  const creditTotals = await customerModel.storeCreditTotals([id]) as any[];
  const balance = creditTotals.reduce((total, row) => total + (row.type === "CREDIT" ? Number(row._sum.amount || 0) : -Number(row._sum.amount || 0)), 0);
  return { ...customerSerializer(x), availableStoreCredit: Math.max(0, balance).toFixed(2) };
}
export async function createCustomer(data: any) {
  return customerSerializer(await customerModel.create(data));
}
export async function updateCustomer(id: string, data: any) {
  await getCustomer(id);
  return customerSerializer(await customerModel.update(id, data));
}
