"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  authenticateUser,
  createSession,
  createUser,
  destroySession,
  normalizeEmail,
} from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";
import { withMessage } from "@/lib/utils/flash";

const authSchema = z.object({
  email: z.email("请输入有效邮箱地址"),
  password: z.string().min(8, "密码至少 8 位"),
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

  const user = await authenticateUser(parsed.data.email, parsed.data.password);
  if (!user) {
    redirect(withMessage(`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "邮箱或密码错误，或账户已被禁用"));
  }

  await createSession(user.id);
  redirect(getSafeRedirectPath(parsed.data.redirectTo));
}

export async function registerAction(formData: FormData) {
  const parsed = authSchema.safeParse({
    email: normalizeEmail(String(formData.get("email") ?? "")),
    password: String(formData.get("password") ?? ""),
    redirectTo: String(formData.get("redirectTo") ?? "") || undefined,
  });
  const redirectTo = getSafeRedirectPath(String(formData.get("redirectTo") ?? "") || undefined);

  if (!parsed.success) {
    redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", parsed.error.issues[0]?.message ?? "注册信息不完整"));
  }

  try {
    const config = await getPlatformConfig();
    const user = await createUser(parsed.data.email, parsed.data.password, config.signupBonus);
    await createSession(user.id);
    redirect(withMessage(getSafeRedirectPath(parsed.data.redirectTo), "success", "注册成功，已发放新用户积分"));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect(withMessage(`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "该邮箱已注册"));
    }
    throw error;
  }
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
