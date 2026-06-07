import crypto from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

const SESSION_COOKIE = "flux_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function createUser(email: string, password: string, signupBonus: number) {
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        wallet: {
          create: {
            balance: signupBonus,
          },
        },
      },
      include: {
        wallet: true,
      },
    });

    await tx.creditTransaction.create({
      data: {
        userId: user.id,
        type: "SIGNUP_BONUS",
        amount: signupBonus,
        balanceAfter: signupBonus,
        note: "新用户注册赠送积分",
      },
    });

    return user;
  });
}

export async function authenticateUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { wallet: true },
  });

  if (!user || user.status !== "ACTIVE") return null;

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  return user;
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date() },
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: sha256(token) },
    });
  }

  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        include: {
          wallet: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    cookieStore.delete(SESSION_COOKIE);
    return null;
  }
  if (session.user.status !== "ACTIVE") {
    return null;
  }

  return session;
}

export async function requireUser() {
  const session = await getCurrentSession();
  if (!session) redirect("/auth/login");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/studio");
  return user;
}
