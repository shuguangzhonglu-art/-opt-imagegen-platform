import {
  DIRECT_HISTORY_PAGE_SIZE,
  getDirectHistoryByUserId,
  saveDirectHistoryForUser,
  type DirectHistoryImage,
} from "@/lib/services/direct-history";
import { getPlatformConfig, getSizeCost } from "@/lib/config";
import { prisma } from "@/lib/db";
import { enqueueDirectGenerateTask } from "@/lib/queue";
import {
  generateImages,
  saveUploadedReferenceImage,
} from "@/lib/services/image-provider";
import { appendDirectImageLog } from "@/lib/services/direct-log";
import { normalizeStoredImageUrl } from "@/lib/services/object-storage";
import { checkContentModeration } from "@/lib/services/risk-control";

export type DirectGenerateStyle = "direct" | "kv";

export type DirectTaskStatus = "pending" | "running" | "succeeded" | "failed";

export type DirectGenerateTaskState = {
  taskId?: string;
  status: DirectTaskStatus;
  error?: string;
  rawError?: string;
  success?: string;
  createdAt?: number;
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

function toDirectStatus(status: string): DirectTaskStatus {
  if (status === "RUNNING") return "running";
  if (status === "SUCCESS") return "succeeded";
  if (status === "FAILED") return "failed";
  return "pending";
}

function parseSourceImagePaths(value?: string | null, fallback?: string | null) {
  if (!value) return fallback ? [fallback] : [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return fallback ? [fallback] : [];
  }
}

function getElapsedMs(task: { startedAt?: Date | null; finishedAt?: Date | null }) {
  if (!task.startedAt) return undefined;
  return (task.finishedAt ?? new Date()).getTime() - task.startedAt.getTime();
}

function formatTaskError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (/<html|<!doctype|cloudflare|error code 524|timeout occurred/i.test(message)) {
    return "上游生成超时，请稍后重试";
  }

  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}

async function taskToState(taskId: string, userId?: string): Promise<DirectGenerateTaskState> {
  const task = await prisma.generationTask.findFirst({
    where: {
      id: taskId,
      ...(userId ? { userId } : {}),
    },
    include: {
      images: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!task) {
    return {
      taskId,
      status: "failed",
      error: "生成任务不存在",
    };
  }

  const sourceImagePaths = parseSourceImagePaths(task.sourceImagePaths, task.sourceImagePath);
  const images = task.images.map((image) => ({
    filePath: normalizeStoredImageUrl(image.filePath),
    width: image.width,
    height: image.height,
  }));
  const history =
    task.status === "SUCCESS"
      ? await getDirectHistoryByUserId(task.userId, {
          offset: 0,
          limit: DIRECT_HISTORY_PAGE_SIZE,
        })
      : undefined;

  return {
    taskId: task.id,
    status: toDirectStatus(task.status),
    error: task.errorMessage ?? undefined,
    rawError: task.rawError ?? undefined,
    success: task.status === "SUCCESS" ? `生成完成，共 ${images.length} 张` : undefined,
    createdAt: task.requestedAt.getTime(),
    history,
    images,
    elapsedMs: getElapsedMs(task),
    submitted: {
      prompt: task.prompt,
      size: task.size,
      sourceImagePath: task.sourceImagePath ?? sourceImagePaths[0],
      sourceImagePaths,
    },
  };
}

export async function startDirectGenerateTask(params: {
  userId: string;
  prompt: string;
  size: string;
  generationStyle?: DirectGenerateStyle;
  sourceImagePath?: string;
  sourceImagePaths?: string[];
  sourceFiles?: File[];
}): Promise<DirectGenerateTaskState> {
  const config = await getPlatformConfig();
  const cost = getSizeCost(config, params.size);
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true },
  });

  await checkContentModeration({
    userId: params.userId,
    userEmail: user?.email,
    endpoint: params.generationStyle === "kv" ? "kv-direct-generate" : "direct-generate",
    prompt: params.prompt,
  });

  const uploadedSourceImages = params.sourceFiles?.length
    ? await Promise.all(
        params.sourceFiles
          .filter((file) => file.size > 0)
          .map((file) => saveUploadedReferenceImage(file)),
      )
    : [];
  const resolvedSourceImagePaths = [
    ...(params.sourceImagePaths ?? (params.sourceImagePath ? [params.sourceImagePath] : [])),
    ...uploadedSourceImages.map((image) => image.filePath),
  ];

  const created = await prisma.$transaction(async (tx) => {
    const runningCount = await tx.generationTask.count({
      where: {
        userId: params.userId,
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    const userPendingLimit = Number(process.env.USER_PENDING_LIMIT ?? 20);
    if (runningCount >= userPendingLimit) {
      throw new Error(`排队任务过多，请等待当前任务完成后再提交`);
    }

    const wallet = await tx.wallet.findUnique({ where: { userId: params.userId } });
    if (!wallet) throw new Error("钱包不存在");

    const task = await tx.generationTask.create({
      data: {
        userId: params.userId,
        prompt: params.prompt,
        sourceImagePath: resolvedSourceImagePaths[0],
        sourceImagePaths: JSON.stringify(resolvedSourceImagePaths),
        style: params.generationStyle || "direct",
        size: params.size,
        quantity: 1,
        quality: "standard",
        unitCost: cost,
        totalCost: cost,
        status: "PENDING",
        queuedAt: new Date(),
      },
    });

    const debit = await tx.wallet.updateMany({
      where: {
        userId: params.userId,
        balance: { gte: cost },
      },
      data: {
        balance: { decrement: cost },
      },
    });

    if (debit.count !== 1) {
      throw new Error(`余额不足，需要 ${cost} 积分`);
    }

    const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: params.userId } });
    await tx.creditTransaction.create({
      data: {
        userId: params.userId,
        type: "GENERATION_DEBIT",
        amount: -cost,
        balanceAfter: updatedWallet.balance,
        relatedTaskId: task.id,
        note: `图片生成 ${params.size}`,
      },
    });

    return task;
  });

  try {
    const job = await enqueueDirectGenerateTask(created.id);
    await prisma.generationTask.update({
      where: { id: created.id },
      data: { queueJobId: String(job.id ?? created.id) },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "队列提交失败";
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId: params.userId },
        data: { balance: { increment: cost } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: params.userId,
          type: "GENERATION_REFUND",
          amount: cost,
          balanceAfter: wallet.balance,
          relatedTaskId: created.id,
          note: "任务入队失败，自动返还积分",
        },
      });
      await tx.generationTask.update({
        where: { id: created.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: "任务队列暂不可用，请稍后重试",
          rawError: message,
        },
      });
    });
    throw new Error("任务队列暂不可用，请稍后重试");
  }

  await appendDirectImageLog("task.created", {
    taskId: created.id,
    size: params.size,
    hasSourceImages: resolvedSourceImagePaths.length > 0,
    promptLength: params.prompt.length,
  });

  return {
    taskId: created.id,
    status: "pending",
    createdAt: created.requestedAt.getTime(),
    submitted: {
      prompt: params.prompt,
      size: params.size,
      sourceImagePath: resolvedSourceImagePaths[0] || params.sourceImagePath,
      sourceImagePaths: resolvedSourceImagePaths,
    },
  };
}

export async function processDirectGenerateTaskById(taskId: string) {
  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!task) return;
  if (task.status === "SUCCESS") return;

  const sourceImagePaths = parseSourceImagePaths(task.sourceImagePaths, task.sourceImagePath);
  const sourceImagePath = sourceImagePaths[0] || task.sourceImagePath || undefined;
  const started = Date.now();

  const claimed = await prisma.generationTask.updateMany({
    where: { id: task.id, status: "PENDING" },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      errorMessage: null,
      rawError: null,
    },
  });

  if (claimed.count === 0) return;

  await appendDirectImageLog("task.running", {
    taskId: task.id,
    size: task.size,
    hasSourceImages: sourceImagePaths.length > 0,
    promptLength: task.prompt.length,
  });

  try {
    const images = await generateImages({
      prompt: task.prompt,
      sourceImagePath,
      sourceImagePaths,
      style: task.style,
      quality: task.quality,
      size: task.size,
      quantity: task.quantity,
      taskId: task.id,
    });

    await saveDirectHistoryForUser({
      userId: task.userId,
      prompt: task.prompt,
      size: task.size,
      sourceImagePath,
      images,
    });

    await prisma.$transaction(async (tx) => {
      await tx.generatedImage.createMany({
        data: images.map((image) => ({
          taskId: task.id,
          userId: task.userId,
          filePath: image.filePath,
          width: image.width,
          height: image.height,
        })),
      });
      await tx.generationTask.update({
        where: { id: task.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          errorMessage: null,
          rawError: null,
        },
      });
    });

    await appendDirectImageLog("task.succeeded", {
      taskId: task.id,
      elapsedMs: Date.now() - started,
      imageCount: images.length,
      images: images.map((image) => image.filePath),
    });
  } catch (error) {
    const errorMessage = formatTaskError(error);
    const rawError =
      error instanceof Error && "rawPayload" in error
        ? String((error as Error & { rawPayload?: unknown }).rawPayload ?? "")
        : undefined;

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.update({
        where: { userId: task.userId },
        data: { balance: { increment: task.totalCost } },
      });
      await tx.creditTransaction.create({
        data: {
          userId: task.userId,
          type: "GENERATION_REFUND",
          amount: task.totalCost,
          balanceAfter: wallet.balance,
          relatedTaskId: task.id,
          note: "任务失败，自动返还积分",
        },
      });
      await tx.generationTask.update({
        where: { id: task.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          retryCount: { increment: 1 },
          errorMessage,
          rawError,
        },
      });
    });

    await appendDirectImageLog("task.failed", {
      taskId: task.id,
      elapsedMs: Date.now() - started,
      error: errorMessage,
      rawError,
    });
  }
}

export async function recoverStaleDirectTasks() {
  const staleBefore = new Date(Date.now() - Number(process.env.DIRECT_STALE_TASK_MS ?? 15 * 60 * 1000));
  const recovered = await prisma.generationTask.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      errorMessage: "Worker 重启后自动恢复队列",
      startedAt: null,
      finishedAt: null,
    },
  });

  const tasks = await prisma.generationTask.findMany({
    where: { status: "PENDING" },
    select: { id: true },
  });
  await Promise.all(tasks.map((task) => enqueueDirectGenerateTask(task.id).catch(() => null)));

  return recovered.count;
}

export async function processNextDirectGenerateTask() {
  return null;
}

export function startDirectTaskWorker() {
  return;
}

export async function getDirectGenerateTask(
  taskId: string,
  userId?: string,
): Promise<DirectGenerateTaskState> {
  return taskToState(taskId, userId);
}

export async function getDirectGenerateTasksByUserId(
  userId: string,
  options?: { includeFinished?: boolean; limit?: number; generationStyle?: DirectGenerateStyle },
): Promise<DirectGenerateTaskState[]> {
  const tasks = await prisma.generationTask.findMany({
    where: {
      userId,
      ...(options?.generationStyle ? { style: options.generationStyle } : {}),
      ...(options?.includeFinished
        ? {}
        : {
            status: { in: ["PENDING", "RUNNING", "FAILED"] },
          }),
    },
    orderBy: { requestedAt: "desc" },
    take: options?.limit ?? 20,
  });

  return Promise.all(tasks.map((task) => taskToState(task.id, userId)));
}

export async function deleteDirectGenerateTask(userId: string, taskId: string) {
  const task = await prisma.generationTask.findUnique({
    where: { id: taskId },
    select: { id: true, userId: true, status: true },
  });
  if (!task) {
    return { success: false, error: "任务不存在" };
  }
  if (task.userId !== userId) {
    return { success: false, error: "无权删除该任务" };
  }
  if (task.status === "RUNNING") {
    return { success: false, error: "运行中的任务不能删除" };
  }

  await prisma.generationTask.delete({ where: { id: taskId } });
  return { success: true };
}

export async function retryDirectGenerateTask(
  taskId: string,
  userId: string,
): Promise<DirectGenerateTaskState> {
  const task = await prisma.generationTask.findUnique({ where: { id: taskId } });
  if (!task) {
    return {
      status: "failed",
      error: "任务不存在",
    };
  }
  if (task.userId !== userId) {
    return {
      status: "failed",
      error: "无权重试该任务",
    };
  }
  if (task.status !== "FAILED") {
    return taskToState(task.id);
  }

  return startDirectGenerateTask({
    userId,
    prompt: task.prompt,
    size: task.size,
    sourceImagePath: task.sourceImagePath ?? undefined,
    sourceImagePaths: parseSourceImagePaths(task.sourceImagePaths, task.sourceImagePath),
    generationStyle: task.style === "kv" ? "kv" : "direct",
    sourceFiles: [],
  });
}
