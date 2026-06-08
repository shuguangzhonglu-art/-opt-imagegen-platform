import crypto from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getPlatformConfig } from "@/lib/config";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

const SESSION_COOKIE = "flux_session";
const BROWSER_COOKIE = "flux_browser";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const BROWSER_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365 * 2;
const EMAIL_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24;

export type AuthFailureReason = "INVALID_CREDENTIALS" | "DISABLED" | "EMAIL_UNVERIFIED";

export type AuthResult =
  | { ok: true; user: NonNullable<Awaited<ReturnType<typeof findUserForAuth>>> }
  | { ok: false; reason: AuthFailureReason };

export class BrowserAccountConflictError extends Error {
  constructor() {
    super("当前浏览器已绑定其他账号，请更换浏览器或先清空该浏览器登录环境");
    this.name = "BrowserAccountConflictError";
  }
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function getDefaultDisplayName() {
  return "新用户";
}

async function findUserForAuth(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: { wallet: true },
  });
}

export async function createUser(email: string, password: string) {
  const passwordHash = await hashPassword(password);

  return prisma.user.create({
    data: {
      email,
      displayName: getDefaultDisplayName(),
      passwordHash,
      wallet: {
        create: {
          balance: 0,
        },
      },
    },
    include: {
      wallet: true,
    },
  });
}

export async function createPendingRegistrationUser(
  email: string,
  password: string,
  displayName: string,
) {
  const existing = await prisma.user.findUnique({
    where: { email },
    include: { wallet: true },
  });

  if (existing?.emailVerifiedAt) {
    return { ok: false as const, reason: "ALREADY_VERIFIED" as const };
  }

  const passwordHash = await hashPassword(password);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          displayName,
          passwordHash,
          status: "ACTIVE",
        },
        include: { wallet: true },
      })
    : await prisma.user.create({
        data: {
          email,
          displayName,
          passwordHash,
          wallet: {
            create: {
              balance: 0,
            },
          },
        },
        include: {
          wallet: true,
        },
      });

  return { ok: true as const, user };
}

export async function authenticateUser(email: string, password: string) {
  const result = await authenticateUserDetailed(email, password);
  return result.ok ? result.user : null;
}

export async function authenticateUserDetailed(email: string, password: string): Promise<AuthResult> {
  const user = await findUserForAuth(email);

  if (!user) return { ok: false, reason: "INVALID_CREDENTIALS" };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { ok: false, reason: "INVALID_CREDENTIALS" };

  if (user.status !== "ACTIVE") return { ok: false, reason: "DISABLED" };
  const config = await getPlatformConfig();
  if (config.emailVerificationEnabled && !user.emailVerifiedAt && user.role !== "ADMIN") {
    return { ok: false, reason: "EMAIL_UNVERIFIED" };
  }

  return { ok: true, user };
}

export async function createEmailVerificationToken(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_MAX_AGE_MS);

  await prisma.emailVerificationToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function createEmailVerificationCode(userId: string) {
  const code = String(crypto.randomInt(100000, 1000000));
  const tokenHash = sha256(`${userId}:${code}`);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.deleteMany({
      where: {
        userId,
        usedAt: null,
      },
    });
    await tx.emailVerificationToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });
  });

  return { code, expiresAt };
}

export async function verifyEmailToken(token: string, signupBonus: number) {
  const tokenHash = sha256(token);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const record = await tx.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            wallet: true,
          },
        },
      },
    });

    if (!record || record.usedAt || record.expiresAt < now) {
      return { ok: false as const, reason: "INVALID_OR_EXPIRED" as const };
    }

    await tx.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    });

    if (record.user.emailVerifiedAt) {
      return { ok: true as const, alreadyVerified: true as const };
    }

    const wallet = record.user.wallet ?? await tx.wallet.create({
      data: {
        userId: record.userId,
        balance: 0,
      },
    });

    const updatedWallet = signupBonus > 0
      ? await tx.wallet.update({
          where: { userId: record.userId },
          data: { balance: { increment: signupBonus } },
        })
      : wallet;

    await tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now },
    });

    if (signupBonus > 0) {
      await tx.creditTransaction.create({
        data: {
          userId: record.userId,
          type: "SIGNUP_BONUS",
          amount: signupBonus,
          balanceAfter: updatedWallet.balance,
          note: "邮箱验证后赠送积分",
        },
      });
    }

    return { ok: true as const, alreadyVerified: false as const };
  });
}

export async function verifyEmailCode(email: string, code: string, signupBonus: number) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email: normalizedEmail },
      include: { wallet: true },
    });
    if (!user) {
      return { ok: false as const, reason: "INVALID_OR_EXPIRED" as const };
    }

    const tokenHash = sha256(`${user.id}:${code}`);
    const record = await tx.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.userId !== user.id || record.usedAt || record.expiresAt < now) {
      return { ok: false as const, reason: "INVALID_OR_EXPIRED" as const };
    }

    await tx.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: now },
    });

    if (user.emailVerifiedAt) {
      return { ok: true as const, alreadyVerified: true as const, userId: user.id };
    }

    const wallet = user.wallet ?? await tx.wallet.create({
      data: {
        userId: user.id,
        balance: 0,
      },
    });

    const updatedWallet = signupBonus > 0
      ? await tx.wallet.update({
          where: { userId: user.id },
          data: { balance: { increment: signupBonus } },
        })
      : wallet;

    await tx.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: now },
    });

    if (signupBonus > 0) {
      await tx.creditTransaction.create({
        data: {
          userId: user.id,
          type: "SIGNUP_BONUS",
          amount: signupBonus,
          balanceAfter: updatedWallet.balance,
          note: "邮箱验证码验证后赠送积分",
        },
      });
    }

    return { ok: true as const, alreadyVerified: false as const, userId: user.id };
  });
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  const cookieStore = await cookies();
  const browserToken = cookieStore.get(BROWSER_COOKIE)?.value ?? crypto.randomBytes(32).toString("hex");
  const browserKeyHash = sha256(browserToken);

  const existingBrowserLock = await prisma.browserLock.findUnique({
    where: { browserKeyHash },
  });

  if (existingBrowserLock && existingBrowserLock.userId !== userId) {
    throw new BrowserAccountConflictError();
  }

  await prisma.$transaction(async (tx) => {
    await tx.browserLock.upsert({
      where: { browserKeyHash },
      update: { userId },
      create: {
        browserKeyHash,
        userId,
      },
    });

    await tx.session.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  });

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  cookieStore.set(BROWSER_COOKIE, browserToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(Date.now() + BROWSER_COOKIE_MAX_AGE_MS),
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
  if (!session) redirect("/auth/login?redirectTo=%2Fstudio");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  return user;
}
