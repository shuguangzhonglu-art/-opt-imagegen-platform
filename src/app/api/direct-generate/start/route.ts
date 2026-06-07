import { NextResponse } from "next/server";
import { z } from "zod";

import { startDirectGenerateTask, startDirectTaskWorker } from "@/lib/services/direct-tasks";

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "size" in value && typeof value.size === "number" && value.size > 0;
}

const generateSchema = z.object({
  apiKey: z.string().min(10, "API Key 不能为空"),
  prompt: z.string().min(8, "提示词至少需要 8 个字符"),
  size: z.string().min(1, "请选择尺寸"),
});

export async function POST(request: Request) {
  startDirectTaskWorker();

  const formData = await request.formData();
  const parsed = generateSchema.safeParse({
    apiKey: String(formData.get("apiKey") ?? "").trim(),
    prompt: String(formData.get("prompt") ?? "").trim(),
    size: String(formData.get("size") ?? "").trim() || "1024x1024",
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "failed",
        error: parsed.error.issues[0]?.message ?? "参数不完整",
      },
      { status: 400 },
    );
  }

  const sourceFiles = formData
    .getAll("sourceImages")
    .filter(isUploadedFile);
  const sourceImagePaths = formData
    .getAll("sourceImagePaths")
    .map((item) => String(item).trim())
    .filter(Boolean);
  const sourceImagePath = sourceImagePaths[0] || String(formData.get("sourceImagePath") ?? "").trim() || undefined;
  const task = await startDirectGenerateTask({
    apiKey: parsed.data.apiKey,
    prompt: parsed.data.prompt,
    size: parsed.data.size,
    sourceImagePath,
    sourceImagePaths,
    sourceFiles,
  });

  return NextResponse.json(task);
}
