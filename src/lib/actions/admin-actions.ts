"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformConfig } from "@/lib/config";
import { generateRedeemCodes } from "@/lib/services/redeem-codes";
import { clearAdminMfaUnlock, createAdminApiKey, unlockAdminMfa, verifyAdminApiKey } from "@/lib/services/admin-mfa";
import { saveRiskControlConfig } from "@/lib/services/risk-control";
import { adjustWalletBalance } from "@/lib/services/wallet";
import { withMessage } from "@/lib/utils/flash";

async function logAdminAction(input: {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
}) {
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      payload: JSON.stringify(input.payload),
    },
  });
}

export async function generateAdminApiKeyAction() {
  const admin = await requireAdmin();
  const key = createAdminApiKey();

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {
      adminMfaEnabled: true,
      adminApiKeyHash: key.hash,
      adminApiKeyTail: key.tail,
    },
    create: {
      id: 1,
      defaultUnitCost: 40,
      availableSizes: "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80",
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
      adminMfaEnabled: true,
      adminApiKeyHash: key.hash,
      adminApiKeyTail: key.tail,
    },
  });

  await unlockAdminMfa(admin.id);

  await logAdminAction({
    adminUserId: admin.id,
    action: "GENERATE_ADMIN_API_KEY",
    targetType: "settings",
    targetId: "admin_mfa",
    payload: { tail: key.tail },
  });

  redirect(withMessage(`/admin/security?newAdminKey=${encodeURIComponent(key.secret)}`, "success", "管理员密钥已生成，请立即保存。"));
}

export async function disableAdminApiKeyAction() {
  const admin = await requireAdmin();

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {
      adminMfaEnabled: false,
      adminApiKeyHash: "",
      adminApiKeyTail: "",
    },
    create: {
      id: 1,
      defaultUnitCost: 40,
      availableSizes: "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80",
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
      adminMfaEnabled: false,
      adminApiKeyHash: "",
      adminApiKeyTail: "",
    },
  });

  await clearAdminMfaUnlock();

  await logAdminAction({
    adminUserId: admin.id,
    action: "DISABLE_ADMIN_API_KEY",
    targetType: "settings",
    targetId: "admin_mfa",
    payload: {},
  });

  redirect(withMessage("/admin/security", "success", "管理员二次验证密钥已关闭"));
}

export async function verifyAdminApiKeyAction(formData: FormData) {
  const admin = await requireAdmin({ skipMfa: true });
  const secret = String(formData.get("adminApiKey") ?? "");
  const redirectTo = String(formData.get("redirectTo") ?? "/admin");

  if (!secret || !(await verifyAdminApiKey(secret))) {
    redirect(withMessage(`/admin/verify?redirectTo=${encodeURIComponent(redirectTo)}`, "error", "管理员密钥错误"));
  }

  await unlockAdminMfa(admin.id);
  redirect(redirectTo.startsWith("/admin") ? redirectTo : "/admin");
}

export async function adjustUserCreditsAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);
  const note = String(formData.get("note") ?? "管理员调整积分");

  if (!userId || !Number.isFinite(amount) || amount === 0) {
    redirect(withMessage("/admin/users", "error", "请输入有效的积分调整值"));
  }

  try {
    const result = await adjustWalletBalance({
      userId,
      amount,
      type: "ADMIN_ADJUSTMENT",
      note,
    });

    await logAdminAction({
      adminUserId: admin.id,
      action: "ADJUST_CREDITS",
      targetType: "user",
      targetId: userId,
      payload: { amount, balanceAfter: result.balanceAfter, note },
    });

    redirect(withMessage("/admin/users", "success", "用户积分已更新"));
  } catch (error) {
    unstable_rethrow(error);
    redirect(withMessage("/admin/users", "error", error instanceof Error ? error.message : "积分更新失败"));
  }
}

export async function toggleUserStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");

  if (!userId || !["ACTIVE", "DISABLED"].includes(nextStatus)) {
    redirect(withMessage("/admin/users", "error", "用户状态更新参数不合法"));
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status: nextStatus as "ACTIVE" | "DISABLED" },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "TOGGLE_USER_STATUS",
    targetType: "user",
    targetId: userId,
    payload: { nextStatus },
  });

  redirect(withMessage("/admin/users", "success", "用户状态已更新"));
}

const codeSchema = z.object({
  batchName: z.string().min(2, "批次名称至少 2 个字符"),
  creditAmount: z.coerce.number().int().min(1, "积分面额必须大于 0"),
  quantity: z.coerce.number().int().min(1).max(500),
  expiresAt: z.string().optional(),
});

export async function generateRedeemCodesAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = codeSchema.safeParse({
    batchName: String(formData.get("batchName") ?? ""),
    creditAmount: Number(formData.get("creditAmount") ?? 0),
    quantity: Number(formData.get("quantity") ?? 1),
    expiresAt: String(formData.get("expiresAt") ?? ""),
  });

  if (!parsed.success) {
    redirect(withMessage("/admin/redeem-codes", "error", parsed.error.issues[0]?.message ?? "卡券生成参数不完整"));
  }

  const codes = await generateRedeemCodes({
    batchName: parsed.data.batchName,
    creditAmount: parsed.data.creditAmount,
    quantity: parsed.data.quantity,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    adminUserId: admin.id,
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "GENERATE_CODES",
    targetType: "redeem_code_batch",
    targetId: parsed.data.batchName,
    payload: { quantity: codes.length, creditAmount: parsed.data.creditAmount },
  });

  redirect(
    withMessage(
      `/admin/redeem-codes?batch=${encodeURIComponent(parsed.data.batchName)}&status=UNUSED`,
      "success",
      `已生成 ${codes.length} 张卡券，可直接下载当前批次`,
    ),
  );
}

export async function disableRedeemCodeAction(formData: FormData) {
  const admin = await requireAdmin();
  const codeId = String(formData.get("codeId") ?? "");

  await prisma.redeemCode.update({
    where: { id: codeId },
    data: { status: "DISABLED" },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "DISABLE_CODE",
    targetType: "redeem_code",
    targetId: codeId,
    payload: {},
  });

  redirect(withMessage("/admin/redeem-codes", "success", "卡券已作废"));
}

export async function updateSettingsAction(formData: FormData) {
  const admin = await requireAdmin();
  const config = await getPlatformConfig();

  const defaultUnitCost = Number(formData.get("defaultUnitCost") ?? config.defaultUnitCost);
  const availableSizes = String(formData.get("availableSizes") ?? "");
  const taskConcurrency = Number(formData.get("taskConcurrency") ?? 1);
  const fileRetentionDays = Number(formData.get("fileRetentionDays") ?? 30);
  const signupBonus = Number(formData.get("signupBonus") ?? 200);

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {
      defaultUnitCost,
      availableSizes,
      taskConcurrency,
      fileRetentionDays,
      signupBonus,
    },
    create: {
      id: 1,
      defaultUnitCost,
      availableSizes,
      taskConcurrency,
      fileRetentionDays,
      signupBonus,
    },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "UPDATE_SETTINGS",
    targetType: "settings",
    targetId: "1",
    payload: { defaultUnitCost, availableSizes, taskConcurrency, fileRetentionDays, signupBonus },
  });

  redirect(withMessage("/admin/settings", "success", "平台参数已保存"));
}

export async function updateSecuritySettingsAction(formData: FormData) {
  const admin = await requireAdmin();

  const emailVerificationEnabled = formData.get("emailVerificationEnabled") === "on";
  const smtpHost = String(formData.get("smtpHost") ?? "").trim();
  const smtpPort = Number(formData.get("smtpPort") ?? 587);
  const smtpUser = String(formData.get("smtpUser") ?? "").trim();
  const smtpPassword = String(formData.get("smtpPassword") ?? "");
  const smtpFrom = String(formData.get("smtpFrom") ?? "").trim();
  const turnstileEnabled = formData.get("turnstileEnabled") === "on";
  const turnstileSiteKey = String(formData.get("turnstileSiteKey") ?? "").trim();
  const turnstileSecretKey = String(formData.get("turnstileSecretKey") ?? "").trim();
  const registerRateLimitEnabled = formData.get("registerRateLimitEnabled") === "on";
  const registerRateLimitWindowMinutes = Number(formData.get("registerRateLimitWindowMinutes") ?? 60);
  const registerRateLimitMax = Number(formData.get("registerRateLimitMax") ?? 5);

  if (!Number.isFinite(smtpPort) || smtpPort < 1) {
    redirect(withMessage("/admin/security", "error", "SMTP 端口不合法"));
  }

  if (!Number.isFinite(registerRateLimitWindowMinutes) || registerRateLimitWindowMinutes < 1 || !Number.isFinite(registerRateLimitMax) || registerRateLimitMax < 1) {
    redirect(withMessage("/admin/security", "error", "注册限流参数不合法"));
  }

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {
      emailVerificationEnabled,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      smtpFrom,
      turnstileEnabled,
      turnstileSiteKey,
      turnstileSecretKey,
      registerRateLimitEnabled,
      registerRateLimitWindowMinutes,
      registerRateLimitMax,
    },
    create: {
      id: 1,
      defaultUnitCost: 40,
      availableSizes: "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80",
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
      emailVerificationEnabled,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpPassword,
      smtpFrom,
      turnstileEnabled,
      turnstileSiteKey,
      turnstileSecretKey,
      registerRateLimitEnabled,
      registerRateLimitWindowMinutes,
      registerRateLimitMax,
    },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "UPDATE_SECURITY_SETTINGS",
    targetType: "settings",
    targetId: "1",
    payload: {
      emailVerificationEnabled,
      smtpHost,
      smtpPort,
      smtpUser,
      smtpFrom,
      turnstileEnabled,
      turnstileSiteKey,
      registerRateLimitEnabled,
      registerRateLimitWindowMinutes,
      registerRateLimitMax,
    },
  });

  redirect(withMessage("/admin/security", "success", "安全配置已保存"));
}

export async function updateRiskControlSettingsAction(formData: FormData) {
  const admin = await requireAdmin();
  const timeoutMs = Number(formData.get("timeoutMs") ?? 3000);
  const retryCount = Number(formData.get("retryCount") ?? 2);
  const sampleRate = Number(formData.get("sampleRate") ?? 100);
  const retentionDays = Number(formData.get("retentionDays") ?? 30);
  const modeRaw = String(formData.get("mode") ?? "PRE_BLOCK");
  const keywordStrategyRaw = String(formData.get("keywordStrategy") ?? "KEYWORD_AND_API");
  const mode = modeRaw === "OBSERVE" || modeRaw === "OFF" ? modeRaw : "PRE_BLOCK";
  const keywordStrategy =
    keywordStrategyRaw === "KEYWORD_ONLY" || keywordStrategyRaw === "API_ONLY"
      ? keywordStrategyRaw
      : "KEYWORD_AND_API";

  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || !Number.isFinite(retryCount) || retryCount < 0) {
    redirect(withMessage("/admin/risk-control", "error", "审计请求参数不合法"));
  }

  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 100 || !Number.isFinite(retentionDays) || retentionDays < 1) {
    redirect(withMessage("/admin/risk-control", "error", "采样率或日志保留参数不合法"));
  }

  await saveRiskControlConfig({
    enabled: formData.get("enabled") === "on",
    mode,
    baseUrl: String(formData.get("baseUrl") ?? "https://api.openai.com").trim() || "https://api.openai.com",
    model: String(formData.get("model") ?? "omni-moderation-latest").trim() || "omni-moderation-latest",
    apiKeys: String(formData.get("apiKeys") ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    timeoutMs,
    retryCount,
    sampleRate,
    keywordStrategy,
    blockedKeywords: String(formData.get("blockedKeywords") ?? "")
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10000),
    retentionDays,
    notifyOnHit: formData.get("notifyOnHit") === "on",
    blockMessage: String(formData.get("blockMessage") ?? "").trim() || "内容审计命中风险规则，请调整输入后重试",
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "UPDATE_RISK_CONTROL_SETTINGS",
    targetType: "settings",
    targetId: "1",
    payload: {
      enabled: formData.get("enabled") === "on",
      mode,
      keywordStrategy,
      timeoutMs,
      retryCount,
      sampleRate,
      retentionDays,
    },
  });

  redirect(withMessage("/admin/risk-control", "success", "内容审计配置已保存"));
}
