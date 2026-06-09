import "server-only";

import crypto from "node:crypto";

import { cookies } from "next/headers";

import { getPlatformConfig } from "@/lib/config";

const ADMIN_MFA_COOKIE = "flux_admin_mfa";
const ADMIN_MFA_MAX_AGE_MS = 1000 * 60 * 60 * 12;

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createAdminApiKey() {
  const secret = `adm_${crypto.randomBytes(32).toString("base64url")}`;
  return {
    secret,
    hash: sha256(secret),
    tail: secret.slice(-8),
  };
}

export async function isAdminMfaRequired() {
  const config = await getPlatformConfig();
  return Boolean(config.adminMfaEnabled && config.adminApiKeyHash);
}

export async function verifyAdminApiKey(secret: string) {
  const config = await getPlatformConfig();
  if (!config.adminMfaEnabled || !config.adminApiKeyHash) return true;
  return timingSafeEqual(sha256(secret.trim()), config.adminApiKeyHash);
}

export async function isAdminMfaUnlocked(userId: string) {
  if (!(await isAdminMfaRequired())) return true;
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_MFA_COOKIE)?.value;
  if (!token) return false;

  const [cookieUserId, expiresAtRaw, signature] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (cookieUserId !== userId || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }

  const config = await getPlatformConfig();
  const expected = sha256(`${cookieUserId}.${expiresAt}.${config.adminApiKeyHash}`);
  return timingSafeEqual(signature, expected);
}

export async function unlockAdminMfa(userId: string) {
  const config = await getPlatformConfig();
  const expiresAt = Date.now() + ADMIN_MFA_MAX_AGE_MS;
  const signature = sha256(`${userId}.${expiresAt}.${config.adminApiKeyHash}`);
  const cookieStore = await cookies();

  cookieStore.set(ADMIN_MFA_COOKIE, `${userId}.${expiresAt}.${signature}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    expires: new Date(expiresAt),
  });
}

export async function clearAdminMfaUnlock() {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_MFA_COOKIE);
}
