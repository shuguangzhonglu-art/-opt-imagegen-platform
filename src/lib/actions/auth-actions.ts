"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  authenticateUserDetailed,
  createEmailVerificationCode,
  createSession,
  createEmailVerificationToken,
  createPendingRegistrationUser,
  destroySession,
  normalizeEmail,
  verifyEmailCode,
  verifyEmailToken,
} from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";
import { sendVerificationCodeEmail } from "@/lib/services/email";
import { countRecentRegistrations, verifyTurnstileToken } from "@/lib/services/security";
import { withMessage } from "@/lib/utils/flash";

const authSchema = z.object({
  email: z.email("请输入有效邮箱地址"),
  password: z.string().min(8, "密码至少 8 位"),
  redirectTo: z.string().optional(),
});

const registerSchema = authSchema.extend({
  displayName: z.string().trim().min(2, "用户名至少 2 个字").max(20, "用户名最多 20 个字"),
});

const codeSchema = z.object({
  email: z.email("请输入有效邮箱地址"),
  code: z.string().trim().regex(/^\d{6}$/, "请输入 6 位验证码"),
  redirectTo: z.string().optional(),
});

function getSafeRedirectPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/studio";
  return value;
}

export async function loginAction(formData: FormData) {
  const parsed = authSchema.safeParse({
    email: normalizeEmail(String(formData.get("email") ?? "")),
    password: String(formData.get("password") ?? ""),
    redirectTo: String(formData.get("redirectTo") ?? "") || undefined,
  });
  const redirectTo = getSafeRedirectPath(String(formData.get("redirectTo") ?? "") || undefined);

  if (!parsed.success) {
    redirect(withMessage(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`, "error", parsed.error.issues[0]?.message ?? "登录信息不完整"));
  }

  const result = await authenticateUserDetailed(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    const message = result.reason === "EMAIL_UNVERIFIED"
      ? "请先完成邮箱验证"
      : result.reason === "DISABLED"
        ? "账户已被禁用"
        : "邮箱或密码错误";
    redirect(withMessage(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`, "error", message));
  }

  await createSession(result.user.id);
  redirect(getSafeRedirectPath(parsed.data.redirectTo));
}

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse({
    email: normalizeEmail(String(formData.get("email") ?? "")),
    displayName: String(formData.get("displayName") ?? ""),
    password: String(formData.get("password") ?? ""),
    redirectTo: String(formData.get("redirectTo") ?? "") || undefined,
  });
  const redirectTo = getSafeRedirectPath(String(formData.get("redirectTo") ?? "") || undefined);

  if (!parsed.success) {
    redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", parsed.error.issues[0]?.message ?? "注册信息不完整"));
  }

  try {
    const config = await getPlatformConfig();
    if (config.turnstileEnabled) {
      const token = String(formData.get("cf-turnstile-response") ?? "");
      const valid = await verifyTurnstileToken(token, config.turnstileSecretKey);
      if (!valid) {
        redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "安全验证失败，请重试"));
      }
    }

    if (config.registerRateLimitEnabled) {
      const recentCount = await countRecentRegistrations(parsed.data.email, config.registerRateLimitWindowMinutes);
      if (recentCount >= config.registerRateLimitMax) {
        redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "注册过于频繁，请稍后再试"));
      }
    }

    const result = await createPendingRegistrationUser(
      parsed.data.email,
      parsed.data.password,
      parsed.data.displayName,
    );
    if (!result.ok) {
      redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "该邮箱已注册"));
    }

    const user = result.user;
    if (!config.emailVerificationEnabled) {
      await verifyEmailToken(await createEmailVerificationToken(user.id).then((item) => item.token), config.signupBonus);
      redirect(withMessage(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`, "success", "注册成功，可以登录"));
    }

    const { code } = await createEmailVerificationCode(user.id);
    await sendVerificationCodeEmail({ to: user.email, code });
    redirect(withMessage(`/auth/register?step=verify&email=${encodeURIComponent(user.email)}&redirectTo=${encodeURIComponent(redirectTo)}`, "success", "验证码已发送到邮箱"));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "该邮箱已注册"));
    }
    throw error;
  }
}

export async function verifyRegisterCodeAction(formData: FormData) {
  const parsed = codeSchema.safeParse({
    email: normalizeEmail(String(formData.get("email") ?? "")),
    code: String(formData.get("code") ?? ""),
    redirectTo: String(formData.get("redirectTo") ?? "") || undefined,
  });
  const redirectTo = getSafeRedirectPath(String(formData.get("redirectTo") ?? "") || undefined);

  if (!parsed.success) {
    redirect(withMessage(`/auth/register?step=verify&email=${encodeURIComponent(String(formData.get("email") ?? ""))}&redirectTo=${encodeURIComponent(redirectTo)}`, "error", parsed.error.issues[0]?.message ?? "验证码无效"));
  }

  const config = await getPlatformConfig();
  const result = await verifyEmailCode(parsed.data.email, parsed.data.code, config.signupBonus);
  if (!result.ok) {
    redirect(withMessage(`/auth/register?step=verify&email=${encodeURIComponent(parsed.data.email)}&redirectTo=${encodeURIComponent(redirectTo)}`, "error", "验证码错误或已过期"));
  }

  await createSession(result.userId);
  redirect(redirectTo);
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function verifyEmailAction(token: string) {
  if (!token) {
    redirect(withMessage("/auth/login", "error", "验证链接无效"));
  }

  const config = await getPlatformConfig();
  const result = await verifyEmailToken(token, config.signupBonus);

  if (!result.ok) {
    redirect(withMessage("/auth/login", "error", "验证链接已失效，请重新注册或联系管理员"));
  }

  redirect(withMessage("/auth/login", "success", result.alreadyVerified ? "邮箱已验证，可以登录" : "邮箱验证成功，积分已发放"));
}
