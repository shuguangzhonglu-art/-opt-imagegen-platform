"use server";

import { z } from "zod";
import { redirect, unstable_rethrow } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  DIRECT_HISTORY_PAGE_SIZE,
  deleteDirectHistoryByUserIdAndFilePath,
  getDirectHistoryByUserId,
  type DirectHistoryImage,
} from "@/lib/services/direct-history";
import {
  deleteDirectGenerateTask,
  getDirectGenerateTask,
  getDirectGenerateTasksByUserId,
  retryDirectGenerateTask,
  startDirectGenerateTask,
  type DirectGenerateTaskState,
} from "@/lib/services/direct-tasks";
import { redeemCodeForUser } from "@/lib/services/wallet";
import { normalizeStoredImageUrl } from "@/lib/services/object-storage";
import { withMessage } from "@/lib/utils/flash";

const generateSchema = z.object({
  prompt: z.string().min(8, "提示词至少需要 8 个字符"),
  size: z.string().min(1, "请选择尺寸"),
});

const redeemSchema = z.object({
  code: z.string().min(6, "请输入兑换券").max(80, "兑换券太长"),
});

const displayNameSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "用户名至少 2 个字")
    .max(20, "用户名最多 20 个字")
    .regex(/^[\p{L}\p{N}_\-\s]+$/u, "用户名只能包含文字、数字、空格、- 和 _"),
});

function getDisplayNameFallback() {
  return "我的账户";
}

export type DirectGenerateState = {
  error?: string;
  success?: string;
  warning?: string;
  history?: DirectHistoryImage[];
  images?: Array<{
    filePath: string;
    width: number;
    height: number;
  }>;
  elapsedMs?: number;
  submitted?: {
    prompt: string;
    size: string;
    sourceImagePath?: string;
    sourceImagePaths?: string[];
  };
};

export async function directGenerateAction(
  _prevState: DirectGenerateState,
  formData: FormData,
): Promise<DirectGenerateState> {
  const user = await requireUser();
  const parsed = generateSchema.safeParse({
    prompt: String(formData.get("prompt") ?? "").trim(),
    size: String(formData.get("size") ?? "").trim() || "1024x1024",
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "参数不完整",
    };
  }

  const sourceFile = formData.get("sourceImage");
  const existingSourceImagePath = String(formData.get("sourceImagePath") ?? "").trim() || undefined;

  try {
    const task = await startDirectGenerateTask({
      userId: user.id,
      prompt: parsed.data.prompt,
      size: parsed.data.size,
      sourceImagePath: existingSourceImagePath,
      sourceImagePaths: existingSourceImagePath ? [existingSourceImagePath] : undefined,
      sourceFiles: sourceFile instanceof File && sourceFile.size > 0 ? [sourceFile] : [],
    });

    return {
      success: "已提交，正在生成",
      elapsedMs: task.elapsedMs,
      images: task.images,
      history: task.history,
      submitted: {
        prompt: parsed.data.prompt,
        size: parsed.data.size,
        sourceImagePath: existingSourceImagePath,
        sourceImagePaths: existingSourceImagePath ? [existingSourceImagePath] : undefined,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成失败";

    return {
      error: message,
      submitted: {
        prompt: parsed.data.prompt,
        size: parsed.data.size,
        sourceImagePath: existingSourceImagePath,
        sourceImagePaths: existingSourceImagePath ? [existingSourceImagePath] : undefined,
      },
    };
  }
}

export async function startDirectGenerateTaskAction(
  formData: FormData,
): Promise<DirectGenerateTaskState> {
  const user = await requireUser();
  const parsed = generateSchema.safeParse({
    prompt: String(formData.get("prompt") ?? "").trim(),
    size: String(formData.get("size") ?? "").trim() || "1024x1024",
  });

  if (!parsed.success) {
    return {
      status: "failed",
      error: parsed.error.issues[0]?.message ?? "参数不完整",
    };
  }

  const sourceFile = formData.get("sourceImage");
  const existingSourceImagePath = String(formData.get("sourceImagePath") ?? "").trim() || undefined;
  try {
    return await startDirectGenerateTask({
      userId: user.id,
      prompt: parsed.data.prompt,
      size: parsed.data.size,
      sourceImagePath: existingSourceImagePath,
      sourceImagePaths: existingSourceImagePath ? [existingSourceImagePath] : undefined,
      sourceFiles: sourceFile instanceof File && sourceFile.size > 0 ? [sourceFile] : [],
    });
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "任务创建失败",
    };
  }
}

export async function getDirectGenerateTaskAction(taskId: string): Promise<DirectGenerateTaskState> {
  const user = await requireUser();
  return getDirectGenerateTask(taskId, user.id);
}

export async function getDirectGenerateTasksAction(): Promise<DirectGenerateTaskState[]> {
  const user = await requireUser();
  return getDirectGenerateTasksByUserId(user.id);
}

export async function getKvGenerateTasksAction(): Promise<DirectGenerateTaskState[]> {
  const user = await requireUser();
  return getDirectGenerateTasksByUserId(user.id, { generationStyle: "kv" });
}

export async function deleteDirectGenerateTaskAction(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return { success: false, error: "删除参数不完整" };
  }

  return deleteDirectGenerateTask(user.id, normalizedTaskId);
}

export async function retryDirectGenerateTaskAction(
  taskId: string,
): Promise<DirectGenerateTaskState> {
  const user = await requireUser();
  const normalizedTaskId = taskId.trim();

  if (!normalizedTaskId) {
    return {
      status: "failed",
      error: "重试参数不完整",
    };
  }

  return retryDirectGenerateTask(normalizedTaskId, user.id);
}

export async function getCurrentUserOverviewAction() {
  const user = await requireUser();
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    include: { wallet: true },
  });
  const taskCount = await prisma.generationTask.count({ where: { userId: user.id } });

  return {
    email: fresh?.email ?? user.email,
    displayName: fresh?.displayName ?? getDisplayNameFallback(),
    role: fresh?.role ?? user.role,
    balance: fresh?.wallet?.balance ?? 0,
    taskCount,
  };
}

export async function getDirectHistoryAction(
  options?: { offset?: number; limit?: number },
): Promise<DirectHistoryImage[]> {
  const user = await requireUser();
  return getDirectHistoryByUserId(user.id, options);
}

export async function getKvHistoryAction(
  options?: { offset?: number; limit?: number },
): Promise<DirectHistoryImage[]> {
  const user = await requireUser();
  const records = await prisma.generatedImage.findMany({
    where: {
      userId: user.id,
      task: {
        style: "kv",
      },
    },
    include: {
      task: {
        select: {
          prompt: true,
          size: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    skip: options?.offset ?? 0,
    take: options?.limit ?? DIRECT_HISTORY_PAGE_SIZE,
  });

  return records.map((record) => ({
    filePath: normalizeStoredImageUrl(record.filePath),
    width: record.width,
    height: record.height,
    prompt: record.task.prompt,
    size: record.task.size,
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function deleteDirectHistoryItemAction(
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const normalizedPath = filePath.trim();

  if (!normalizedPath) {
    return { success: false, error: "删除参数不完整" };
  }

  const deletedCount = await deleteDirectHistoryByUserIdAndFilePath(user.id, normalizedPath);
  if (!deletedCount) {
    return { success: false, error: "未找到可删除的记录" };
  }

  return { success: true };
}

export async function redeemCodeAction(formData: FormData) {
  const user = await requireUser();
  const parsed = redeemSchema.safeParse({
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
  });

  if (!parsed.success) {
    redirect(withMessage("/credits", "error", parsed.error.issues[0]?.message ?? "兑换券无效"));
  }

  try {
    const result = await redeemCodeForUser({
      userId: user.id,
      code: parsed.data.code,
    });
    redirect(withMessage("/credits", "success", `已兑换 ${result.redeemCode.creditAmount} 积分`));
  } catch (error) {
    unstable_rethrow(error);
    redirect(withMessage("/credits", "error", error instanceof Error ? error.message : "兑换失败"));
  }
}

export async function updateDisplayNameAction(formData: FormData) {
  const user = await requireUser();
  const parsed = displayNameSchema.safeParse({
    displayName: String(formData.get("displayName") ?? ""),
  });

  if (!parsed.success) {
    redirect(withMessage("/credits", "error", parsed.error.issues[0]?.message ?? "用户名无效"));
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { displayName: parsed.data.displayName },
  });

  redirect(withMessage("/credits", "success", "用户名已更新"));
}
