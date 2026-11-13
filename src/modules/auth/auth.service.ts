import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { ApiError } from "../../shared/errors.js";
import { authModel } from "./auth.model.js";
import { userSerializer } from "./auth.serializer.js";

const hashRefreshToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const createAccessToken = (user: { id: string; role: string }) =>
  jwt.sign({ role: user.role }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });

const createRefreshToken = () => randomBytes(32).toString("base64url");

const refreshExpiry = () =>
  new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

async function createSession(user: any) {
  const refreshToken = createRefreshToken();
  const expiresAt = refreshExpiry();
  await authModel.deleteExpiredRefreshSessions(new Date());
  await authModel.createRefreshSession({
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });
  return {
    token: createAccessToken(user),
    user: userSerializer(user),
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function login(email: string, password: string) {
  const user = await authModel.findByEmail(email.toLowerCase());
  if (
    !user ||
    !user.active ||
    !(await bcrypt.compare(password, user.passwordHash))
  )
    throw new ApiError(401, "Invalid email or password");
  return createSession(user);
}

export async function refresh(refreshToken: string | undefined) {
  if (!refreshToken) throw new ApiError(401, "Refresh session is missing or expired");
  const oldHash = hashRefreshToken(refreshToken);
  const session = await authModel.findRefreshSession(oldHash);
  if (!session || session.expiresAt <= new Date() || !session.user.active)
    throw new ApiError(401, "Refresh session is missing or expired");
  return {
    token: createAccessToken(session.user),
    user: userSerializer(session.user),
  };
}

export async function logout(refreshToken: string | undefined) {
  if (refreshToken) await authModel.deleteRefreshSession(hashRefreshToken(refreshToken));
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: "ADMIN" | "STAFF";
}) {
  const user = await authModel.createUser({
    name: input.name,
    email: input.email.toLowerCase(),
    passwordHash: await bcrypt.hash(input.password, 12),
    role: input.role,
  });
  return userSerializer(user);
}
