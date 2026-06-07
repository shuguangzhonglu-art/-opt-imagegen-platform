import fs from "node:fs/promises";
import path from "node:path";

import {
  DIRECT_HISTORY_PAGE_SIZE,
  getDirectHistoryByApiKey,
  hashUserApiKey,
  saveDirectHistory,
  type DirectHistoryImage,
} from "@/lib/services/direct-history";
import {
  generateImagesWithUserConfig,
  saveUploadedReferenceImage,
} from "@/lib/services/image-provider";
import { appendDirectImageLog } from "@/lib/services/direct-log";
import { normalizeStoredImageUrl } from "@/lib/services/object-storage";

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

type DirectTaskRecord = DirectGenerateTaskState & {
  createdAt: number;
  userKeyHash: string;
  apiKey?: string;
  sourceFilePaths?: string[];
};

const TASK_DIR = path.join(process.cwd(), "public", "generated", "tasks");
const TASK_TTL_MS = 30 * 60 * 1000;

declare global {
  var __directWorkerStarted: boolean | undefined;
  var __directWorkerProcessing: boolean | undefined;
}

function createTaskId() {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTaskPath(taskId: string) {
  return path.join(TASK_DIR, `${taskId}.json`);
}

async function ensureTaskDir() {
  await fs.mkdir(TASK_DIR, { recursive: true });
}

async function writeTask(task: DirectTaskRecord) {
  await ensureTaskDir();
  await fs.writeFile(getTaskPath(task.taskId || "unknown"), JSON.stringify(task), "utf8");
}

async function readTask(taskId: string): Promise<DirectTaskRecord | null> {
  try {
    const content = await fs.readFile(getTaskPath(taskId), "utf8");
    return JSON.parse(content) as DirectTaskRecord;
  } catch {
    return null;
  }
}

async function deleteTaskFile(taskId: string) {
  try {
    await fs.unlink(getTaskPath(taskId));
    return true;
  } catch {
    return false;
  }
}

async function cleanupDirectTasks() {
  await ensureTaskDir();
  const entries = await fs.readdir(TASK_DIR, { withFileTypes: true });
  const expiresAt = Date.now() - TASK_TTL_MS;

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const filePath = path.join(TASK_DIR, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs < expiresAt) {
            await fs.unlink(filePath);
          }
        } catch {
          return;
        }
      }),
  );
}

export async function startDirectGenerateTask(params: {
  apiKey: string;
  prompt: string;
  size: string;
  sourceImagePath?: string;
  sourceImagePaths?: string[];
  sourceFiles?: File[];
}): Promise<DirectGenerateTaskState> {
  await cleanupDirectTasks();

  const taskId = createTaskId();
  const userKeyHash = hashUserApiKey(params.apiKey);
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
  const baseTask: DirectTaskRecord = {
    taskId,
    status: "pending",
    createdAt: Date.now(),
    userKeyHash,
    apiKey: params.apiKey,
    sourceFilePaths: resolvedSourceImagePaths,
    submitted: {
      prompt: params.prompt,
      size: params.size,
      sourceImagePath: resolvedSourceImagePaths[0] || params.sourceImagePath,
      sourceImagePaths: resolvedSourceImagePaths,
    },
  };

  await writeTask(baseTask);
  await appendDirectImageLog("task.created", {
    taskId,
    size: params.size,
    hasSourceImages: resolvedSourceImagePaths.length > 0,
    promptLength: params.prompt.length,
  });

  void processNextDirectGenerateTask().catch((error) => {
    console.error("direct-task-start", error);
  });

  return {
    taskId,
    status: "pending",
    createdAt: baseTask.createdAt,
    submitted: baseTask.submitted,
  };
}

async function processDirectTask(task: DirectTaskRecord) {
  const started = Date.now();
  const sourceImagePaths = task.sourceFilePaths ?? task.submitted?.sourceImagePaths ?? [];
  const sourceImagePath = sourceImagePaths[0] || task.submitted?.sourceImagePath;
  const apiKey = task.apiKey;

  if (!apiKey || !task.taskId || !task.submitted?.prompt || !task.submitted.size) {
    await writeTask({
      ...task,
      status: "failed",
      error: "任务缺少必要参数，无法执行",
    });
    return;
  }

  await writeTask({
    ...task,
    status: "running",
    error: undefined,
    rawError: undefined,
  });
  await appendDirectImageLog("task.running", {
    taskId: task.taskId,
    size: task.submitted.size,
    hasSourceImages: sourceImagePaths.length > 0,
    promptLength: task.submitted.prompt.length,
  });

  try {
    const images = await generateImagesWithUserConfig(
      {
        prompt: task.submitted.prompt,
        sourceImagePath,
        sourceImagePaths,
        background: "auto",
        size: task.submitted.size,
        quantity: 1,
      },
      {
        apiKey,
        baseURL: "https://hemasir.online/v1",
        model: "gpt-image-2",
        wireApi: "images",
      },
    );

    await saveDirectHistory({
      apiKey,
      prompt: task.submitted.prompt,
      size: task.submitted.size,
      sourceImagePath,
      images,
    });

    const history = await getDirectHistoryByApiKey(apiKey, {
      offset: 0,
      limit: DIRECT_HISTORY_PAGE_SIZE,
    });

    await writeTask({
      ...task,
      status: "succeeded",
      success: `生成完成，共 ${images.length} 张`,
      elapsedMs: Date.now() - started,
      images,
      history,
      submitted: {
        prompt: task.submitted.prompt,
        size: task.submitted.size,
        sourceImagePath,
        sourceImagePaths,
      },
    });
    await appendDirectImageLog("task.succeeded", {
      taskId: task.taskId,
      elapsedMs: Date.now() - started,
      imageCount: images.length,
      images: images.map((image) => image.filePath),
    });
  } catch (error) {
    const rawError =
      error instanceof Error && "rawPayload" in error
        ? String((error as Error & { rawPayload?: unknown }).rawPayload ?? "")
        : undefined;
    await writeTask({
      ...task,
      status: "failed",
      error: error instanceof Error ? error.message : "生成失败",
      rawError,
      submitted: {
        prompt: task.submitted.prompt,
        size: task.submitted.size,
        sourceImagePath,
        sourceImagePaths,
      },
    });
    await appendDirectImageLog("task.failed", {
      taskId: task.taskId,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      rawError,
    });
  }
}

export async function processNextDirectGenerateTask() {
  await cleanupDirectTasks();
  await ensureTaskDir();

  if (global.__directWorkerProcessing) return;
  global.__directWorkerProcessing = true;

  try {
    const entries = await fs.readdir(TASK_DIR, { withFileTypes: true });
    const tasks = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => readTask(entry.name.replace(/\.json$/, ""))),
    );

    const nextTask = tasks
      .filter((task): task is DirectTaskRecord => Boolean(task))
      .filter((task) => task.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)[0];

    if (!nextTask) return;
    await processDirectTask(nextTask);
  } finally {
    global.__directWorkerProcessing = false;
  }
}

export function startDirectTaskWorker() {
  if (global.__directWorkerStarted) return;
  global.__directWorkerStarted = true;

  const intervalMs = Number(process.env.DIRECT_TASK_POLL_MS ?? 1500);
  void processNextDirectGenerateTask().catch((error) => {
    console.error("direct-task-worker", error);
  });

  setInterval(async () => {
    try {
      await processNextDirectGenerateTask();
    } catch (error) {
      console.error("direct-task-worker", error);
    }
  }, intervalMs).unref();
}

export async function getDirectGenerateTask(taskId: string): Promise<DirectGenerateTaskState> {
  await cleanupDirectTasks();

  const task = await readTask(taskId);
  if (!task) {
    return {
      taskId,
      status: "failed",
      error: "生成任务已过期，请重新提交",
    };
  }

  return {
    ...task,
    images: task.images?.map((image) => ({
      ...image,
      filePath: normalizeStoredImageUrl(image.filePath),
    })),
    history: task.history?.map((image) => ({
      ...image,
      filePath: normalizeStoredImageUrl(image.filePath),
    })),
  };
}

export async function getDirectGenerateTasksByApiKey(
  apiKey: string,
  options?: { includeFinished?: boolean; limit?: number },
): Promise<DirectGenerateTaskState[]> {
  await cleanupDirectTasks();
  await ensureTaskDir();

  const userKeyHash = hashUserApiKey(apiKey);
  const entries = await fs.readdir(TASK_DIR, { withFileTypes: true });
  const tasks = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => readTask(entry.name.replace(/\.json$/, ""))),
  );

  return tasks
    .filter((task): task is DirectTaskRecord => Boolean(task))
    .filter((task) => task.userKeyHash === userKeyHash)
    .filter((task) =>
      options?.includeFinished ? true : task.status === "pending" || task.status === "running" || task.status === "failed",
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, options?.limit ?? 20)
    .map((task) => ({
      taskId: task.taskId,
      status: task.status,
      error: task.error,
      success: task.success,
      createdAt: task.createdAt,
      history: task.history,
      images: task.images,
      elapsedMs: task.elapsedMs,
      submitted: task.submitted,
    }));
}

export async function deleteDirectGenerateTask(apiKey: string, taskId: string) {
  await cleanupDirectTasks();
  const task = await readTask(taskId);
  if (!task) {
    return { success: false, error: "任务不存在或已过期" };
  }

  const userKeyHash = hashUserApiKey(apiKey);
  if (task.userKeyHash !== userKeyHash) {
    return { success: false, error: "无权删除该任务" };
  }

  const deleted = await deleteTaskFile(taskId);
  return deleted ? { success: true } : { success: false, error: "删除失败" };
}

export async function retryDirectGenerateTask(apiKey: string, taskId: string): Promise<DirectGenerateTaskState> {
  await cleanupDirectTasks();
  const task = await readTask(taskId);
  if (!task) {
    return {
      status: "failed",
      error: "任务不存在或已过期",
    };
  }

  const userKeyHash = hashUserApiKey(apiKey);
  if (task.userKeyHash !== userKeyHash) {
    return {
      status: "failed",
      error: "无权重试该任务",
    };
  }

  const submitted = task.submitted;
  if (!submitted?.prompt || !submitted.size) {
    return {
      status: "failed",
      error: "缺少重试所需的任务参数",
    };
  }

  return startDirectGenerateTask({
    apiKey,
    prompt: submitted.prompt,
    size: submitted.size,
    sourceImagePath: submitted.sourceImagePath,
    sourceImagePaths: submitted.sourceImagePaths,
    sourceFiles: [],
  });
}
