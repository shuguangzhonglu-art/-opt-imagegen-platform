"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPlatformConfig } from "@/lib/config";
import { generateRedeemCodes } from "@/lib/services/redeem-codes";
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

  redirect(withMessage("/admin/redeem-codes", "success", `已生成 ${codes.length} 张卡券`));
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
