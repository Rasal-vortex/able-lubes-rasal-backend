import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { ApiError } from "../../shared/errors.js";
import { createUser, login, logout, refresh } from "./auth.service.js";

const refreshCookieName = "able_lubes_refresh";
const refreshCookiePath = "/api/v1/auth";
const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());

function readRefreshCookie(req: Request) {
  const prefix = `${refreshCookieName}=`;
  const entry = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined;
}

function assertAllowedOrigin(req: Request) {
  const origin = req.get("origin");
  if (origin && !allowedOrigins.includes(origin)) {
    throw new ApiError(403, "Request origin is not allowed");
  }
}

function writeRefreshCookie(res: Response, token: string, expiresAt: Date) {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  const sameSite = env.NODE_ENV === "production" ? "None" : "Lax";
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${refreshCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=${refreshCookiePath}; SameSite=${sameSite}; Max-Age=${Math.floor(maxAge / 1000)}${secure}`);
}

function clearRefreshCookie(res: Response) {
  const sameSite = env.NODE_ENV === "production" ? "None" : "Lax";
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  res.append("Set-Cookie", `${refreshCookieName}=; HttpOnly; Path=${refreshCookiePath}; SameSite=${sameSite}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`);
}

export async function loginController(req: Request, res: Response) {
  const session = await login(req.body.email, req.body.password);
  writeRefreshCookie(res, session.refreshToken, session.refreshTokenExpiresAt);
  return res.json({
    success: true,
    data: { token: session.token, user: session.user },
  });
}

export async function refreshController(req: Request, res: Response) {
  assertAllowedOrigin(req);
  const session = await refresh(readRefreshCookie(req));
  return res.json({ success: true, data: { token: session.token, user: session.user } });
}

export async function logoutController(req: Request, res: Response) {
  assertAllowedOrigin(req);
  await logout(readRefreshCookie(req));
  clearRefreshCookie(res);
  return res.json({ success: true, data: { loggedOut: true } });
}
export async function createUserController(req: Request, res: Response) {
  return res
    .status(201)
    .json({ success: true, data: await createUser(req.body) });
}
