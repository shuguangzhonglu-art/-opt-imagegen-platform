import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentSession } from "@/lib/auth";
import { startDirectGenerateTask } from "@/lib/services/direct-tasks";

function isUploadedFile(value: FormDataEntryValue): value is File {
  return typeof value === "object" && value !== null && "size" in value && typeof value.size === "number" && value.size > 0;
}

const generateSchema = z.object({
  prompt: z.string().min(8, "提示词至少需要 8 个字符"),
  size: z.string().min(1, "请选择尺寸"),
  generationStyle: z.enum(["direct", "kv"]).optional(),
});

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      {
        status: "failed",
        error: "请先登录",
      },
      { status: 401 },
    );
  }

  const formData = await request.formData();
  const parsed = generateSchema.safeParse({
    prompt: String(formData.get("prompt") ?? "").trim(),
    size: String(formData.get("size") ?? "").trim() || "1024x1024",
    generationStyle: String(formData.get("generationStyle") ?? "").trim() || undefined,
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
  let task;
  try {
    task = await startDirectGenerateTask({
      userId: session.userId,
      prompt: parsed.data.prompt,
      size: parsed.data.size,
      generationStyle: parsed.data.generationStyle,
      sourceImagePath,
      sourceImagePaths,
      sourceFiles,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "failed",
        error: error instanceof Error ? error.message : "任务创建失败",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(task);
}
