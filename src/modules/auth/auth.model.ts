import { prisma } from "../../config/prisma.js";
export const authModel = {
  findByEmail: (email: string) => prisma.user.findUnique({ where: { email } }),
  createUser: (data: any) => prisma.user.create({ data }),
  findRefreshSession: (tokenHash: string, db: any = prisma) =>
    db.refreshSession.findUnique({ where: { tokenHash }, include: { user: true } }),
  createRefreshSession: (data: { userId: string; tokenHash: string; expiresAt: Date }, db: any = prisma) =>
    db.refreshSession.create({ data }),
  deleteRefreshSession: (tokenHash: string, db: any = prisma) =>
    db.refreshSession.deleteMany({ where: { tokenHash } }),
  deleteExpiredRefreshSessions: (now: Date) =>
    prisma.refreshSession.deleteMany({ where: { expiresAt: { lte: now } } }),
};
