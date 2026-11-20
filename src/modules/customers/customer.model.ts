import { prisma } from "../../config/prisma.js";
export const customerModel = {
  list: (where: any, skip: number, take: number) =>
    prisma.customer.findMany({ where, skip, take, orderBy: { name: "asc" } }),
  count: (where: any) => prisma.customer.count({ where }),
  storeCreditTotals: (customerIds: string[]) => customerIds.length
    ? prisma.customerStoreCreditTransaction.groupBy({ by: ["customerId", "type"], where: { customerId: { in: customerIds } }, _sum: { amount: true } })
    : Promise.resolve([]),
  get: (id: string) => prisma.customer.findUnique({ where: { id } }),
  create: (data: any) => prisma.customer.create({ data }),
  update: (id: string, data: any) =>
    prisma.customer.update({ where: { id }, data }),
};
