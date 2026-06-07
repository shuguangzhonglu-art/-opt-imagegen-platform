"use server";

import { z } from "zod";

import {
  generateImagesWithUserConfig,
  saveUploadedReferenceImage,
} from "@/lib/services/image-provider";
import {
  DIRECT_HISTORY_PAGE_SIZE,
  deleteDirectHistoryByFilePath,
  getDirectHistoryByApiKey,
  saveDirectHistory,
  type DirectHistoryImage,
} from "@/lib/services/direct-history";
import {
  deleteDirectGenerateTask,
  getDirectGenerateTask,
  getDirectGenerateTasksByApiKey,
  retryDirectGenerateTask,
  startDirectGenerateTask,
  type DirectGenerateTaskState,
} from "@/lib/services/direct-tasks";

const generateSchema = z.object({
  apiKey: z.string().min(10, "API Key 不能为空"),
  prompt: z.string().min(8, "提示词至少需要 8 个字符"),
  size: z.string().min(1, "请选择尺寸"),
});

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
  const parsed = generateSchema.safeParse({
    apiKey: String(formData.get("apiKey") ?? "").trim(),
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
    const started = Date.now();
    const sourceImage =
      sourceFile instanceof File && sourceFile.size > 0 ? await saveUploadedReferenceImage(sourceFile) : null;
    const resolvedSourceImagePath = sourceImage?.filePath || existingSourceImagePath;
    const images = await generateImagesWithUserConfig(
      {
        prompt: parsed.data.prompt,
        sourceImagePath: resolvedSourceImagePath,
        background: "auto",
        size: parsed.data.size,
        quantity: 1,
      },
      {
        apiKey: parsed.data.apiKey,
        baseURL: "https://hemasir.online/v1",
        model: "gpt-image-2",
        wireApi: "images",
      },
    );

    await saveDirectHistory({
      apiKey: parsed.data.apiKey,
      prompt: parsed.data.prompt,
      size: parsed.data.size,
      sourceImagePath: resolvedSourceImagePath,
      images,
    });

    const history = await getDirectHistoryByApiKey(parsed.data.apiKey, {
      offset: 0,
      limit: DIRECT_HISTORY_PAGE_SIZE,
    });

    return {
      success: `生成完成，共 ${images.length} 张`,
      elapsedMs: Date.now() - started,
      images,
      history,
      submitted: {
        prompt: parsed.data.prompt,
        size: parsed.data.size,
        sourceImagePath: resolvedSourceImagePath,
        sourceImagePaths: resolvedSourceImagePath ? [resolvedSourceImagePath] : undefined,
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
  const parsed = generateSchema.safeParse({
    apiKey: String(formData.get("apiKey") ?? "").trim(),
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
  return startDirectGenerateTask({
    apiKey: parsed.data.apiKey,
    prompt: parsed.data.prompt,
    size: parsed.data.size,
    sourceImagePath: existingSourceImagePath,
    sourceImagePaths: existingSourceImagePath ? [existingSourceImagePath] : undefined,
    sourceFiles: sourceFile instanceof File && sourceFile.size > 0 ? [sourceFile] : [],
  });
}

export async function getDirectGenerateTaskAction(taskId: string): Promise<DirectGenerateTaskState> {
  return getDirectGenerateTask(taskId);
}

export async function getDirectGenerateTasksByApiKeyAction(
  apiKey: string,
): Promise<DirectGenerateTaskState[]> {
  const normalizedKey = apiKey.trim();
  if (normalizedKey.length < 10) {
    return [];
  }

  return getDirectGenerateTasksByApiKey(normalizedKey);
}

export async function deleteDirectGenerateTaskAction(
  apiKey: string,
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedKey = apiKey.trim();
  const normalizedTaskId = taskId.trim();

  if (normalizedKey.length < 10 || !normalizedTaskId) {
    return { success: false, error: "删除参数不完整" };
  }

  return deleteDirectGenerateTask(normalizedKey, normalizedTaskId);
}

export async function retryDirectGenerateTaskAction(
  apiKey: string,
  taskId: string,
): Promise<DirectGenerateTaskState> {
  const normalizedKey = apiKey.trim();
  const normalizedTaskId = taskId.trim();

  if (normalizedKey.length < 10 || !normalizedTaskId) {
    return {
      status: "failed",
      error: "重试参数不完整",
    };
  }

  return retryDirectGenerateTask(normalizedKey, normalizedTaskId);
}

export async function getDirectHistoryAction(
  apiKey: string,
  options?: { offset?: number; limit?: number },
): Promise<DirectHistoryImage[]> {
  const normalizedKey = apiKey.trim();
  if (normalizedKey.length < 10) {
    return [];
  }

  return getDirectHistoryByApiKey(normalizedKey, options);
}

export async function deleteDirectHistoryItemAction(
  apiKey: string,
  filePath: string,
): Promise<{ success: boolean; error?: string }> {
  const normalizedKey = apiKey.trim();
  const normalizedPath = filePath.trim();

  if (normalizedKey.length < 10 || !normalizedPath) {
    return { success: false, error: "删除参数不完整" };
  }

  const deletedCount = await deleteDirectHistoryByFilePath(normalizedKey, normalizedPath);
  if (!deletedCount) {
    return { success: false, error: "未找到可删除的记录" };
  }

  return { success: true };
}
