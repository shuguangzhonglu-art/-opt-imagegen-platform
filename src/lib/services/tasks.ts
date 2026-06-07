import { prisma } from "@/lib/db";
import { getPlatformConfig, getSizeCost } from "@/lib/config";
import { adjustWalletBalance } from "@/lib/services/wallet";
import { generateImages } from "@/lib/services/image-provider";

export async function createGenerationTask(input: {
  userId: string;
  prompt: string;
  sourceImagePath?: string;
  style: string;
  size: string;
  quantity: number;
  quality: string;
}) {
  const config = await getPlatformConfig();
  const unitCost = getSizeCost(config, input.size);
  const totalCost = unitCost * input.quantity;

  const task = await prisma.generationTask.create({
    data: {
      userId: input.userId,
      prompt: input.prompt,
      sourceImagePath: input.sourceImagePath,
      style: input.style,
      size: input.size,
      quantity: input.quantity,
      quality: input.quality,
      unitCost,
      totalCost,
      status: "PENDING",
    },
  });

  await adjustWalletBalance({
    userId: input.userId,
    amount: -totalCost,
    type: "GENERATION_DEBIT",
    note: `提交生成任务，尺寸 ${input.size}，数量 ${input.quantity}`,
    relatedTaskId: task.id,
  });

  return task;
}

export async function recoverStaleRunningTasks() {
  const recovered = await prisma.generationTask.updateMany({
    where: { status: "RUNNING" },
    data: {
      status: "PENDING",
      startedAt: null,
      errorMessage: "服务重启后自动恢复队列",
    },
  });

  return recovered.count;
}

export async function processNextPendingTask() {
  const nextTask = await prisma.generationTask.findFirst({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
  });

  if (!nextTask) return null;

  const claimed = await prisma.generationTask.updateMany({
    where: { id: nextTask.id, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });

  if (claimed.count === 0) return null;

  try {
    const generated = await generateImages({
      prompt: nextTask.prompt,
      sourceImagePath: nextTask.sourceImagePath ?? undefined,
      style: nextTask.style,
      size: nextTask.size,
      quality: nextTask.quality,
      quantity: nextTask.quantity,
      taskId: nextTask.id,
    });

    await prisma.$transaction(async (tx) => {
      await tx.generatedImage.createMany({
        data: generated.map((image) => ({
          taskId: nextTask.id,
          userId: nextTask.userId,
          filePath: image.filePath,
          width: image.width,
          height: image.height,
        })),
      });

      await tx.generationTask.update({
        where: { id: nextTask.id },
        data: { status: "SUCCESS", finishedAt: new Date() },
      });
    });

    return { id: nextTask.id, status: "SUCCESS" as const };
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId: nextTask.userId },
      });
      const nextBalance = wallet.balance + nextTask.totalCost;

      await tx.wallet.update({
        where: { userId: nextTask.userId },
        data: { balance: nextBalance },
      });

      await tx.creditTransaction.create({
        data: {
          userId: nextTask.userId,
          type: "GENERATION_REFUND",
          amount: nextTask.totalCost,
          balanceAfter: nextBalance,
          relatedTaskId: nextTask.id,
          note: "任务失败，自动返还积分",
        },
      });

      await tx.generationTask.update({
        where: { id: nextTask.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : "未知错误",
        },
      });
    });

    return { id: nextTask.id, status: "FAILED" as const };
  }
}
