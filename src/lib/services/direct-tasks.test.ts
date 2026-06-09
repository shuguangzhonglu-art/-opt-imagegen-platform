import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    wallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    creditGrant: {
      aggregate: vi.fn(),
    },
    creditGrantUsage: {
      findMany: vi.fn(),
    },
    creditTransaction: {
      create: vi.fn(),
    },
    generationTask: {
      update: vi.fn(),
    },
  };

  return {
    tx,
    prisma: {
      generationTask: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      generatedImage: {
        createMany: vi.fn(),
      },
      $transaction: vi.fn((callback: (txClient: typeof tx) => unknown) => callback(tx)),
    },
    generateImages: vi.fn(),
    enqueueDirectGenerateTask: vi.fn(),
    appendDirectImageLog: vi.fn(),
    saveDirectHistoryForUser: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/queue", () => ({
  enqueueDirectGenerateTask: mocks.enqueueDirectGenerateTask,
}));

vi.mock("@/lib/services/image-provider", () => ({
  generateImages: mocks.generateImages,
}));

vi.mock("@/lib/services/direct-log", () => ({
  appendDirectImageLog: mocks.appendDirectImageLog,
}));

vi.mock("@/lib/services/direct-history", () => ({
  DIRECT_HISTORY_PAGE_SIZE: 20,
  getDirectHistoryByUserId: vi.fn(),
  saveDirectHistoryForUser: mocks.saveDirectHistoryForUser,
}));

vi.mock("@/lib/services/object-storage", () => ({
  normalizeStoredImageUrl: (value: string) => value,
}));

import { processDirectGenerateTaskById } from "./direct-tasks";

describe("processDirectGenerateTaskById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECT_UPSTREAM_RETRY_LIMIT = "2";
    process.env.DIRECT_UPSTREAM_RETRY_DELAY_MS = "0";
    mocks.prisma.generationTask.findUnique.mockResolvedValue({
      id: "task1",
      userId: "u1",
      prompt: "生成一张产品主视觉海报",
      sourceImagePath: null,
      sourceImagePaths: "[]",
      style: "direct",
      size: "1024x1024",
      quality: "standard",
      quantity: 1,
      totalCost: 40,
      status: "PENDING",
      retryCount: 0,
    });
    mocks.prisma.generationTask.updateMany.mockResolvedValue({ count: 1 });
    mocks.enqueueDirectGenerateTask.mockResolvedValue({ id: "job1" });
    mocks.tx.wallet.findUnique.mockResolvedValue({ userId: "u1", balance: 0 });
    mocks.tx.creditGrant.aggregate.mockResolvedValue({ _sum: { remaining: 0 } });
    mocks.tx.creditGrantUsage.findMany.mockResolvedValue([]);
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "tx1" });
  });

  it("silently requeues transient upstream failures without refunding or exposing a failed task", async () => {
    mocks.generateImages.mockRejectedValue(new Error("图片生成超时，等待上游结果过久"));

    await processDirectGenerateTaskById("task1");

    expect(mocks.prisma.generationTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({
        status: "PENDING",
        startedAt: null,
        finishedAt: null,
        retryCount: { increment: 1 },
        errorMessage: null,
        rawError: null,
      }),
    });
    expect(mocks.enqueueDirectGenerateTask).toHaveBeenCalledWith("task1", { jobId: "task1:retry:1" });
    expect(mocks.tx.creditTransaction.create).not.toHaveBeenCalled();
    expect(mocks.tx.generationTask.update).not.toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({ status: "FAILED" }),
    });
  });

  it("silently requeues generic upstream errors too", async () => {
    mocks.generateImages.mockRejectedValue(new Error("图片接口调用失败（500）：upstream account error"));

    await processDirectGenerateTaskById("task1");

    expect(mocks.prisma.generationTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({
        status: "PENDING",
        retryCount: { increment: 1 },
        errorMessage: null,
      }),
    });
    expect(mocks.enqueueDirectGenerateTask).toHaveBeenCalledWith("task1", { jobId: "task1:retry:1" });
    expect(mocks.tx.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("silently requeues auth-like upstream errors too", async () => {
    mocks.generateImages.mockRejectedValue(new Error("图片接口鉴权失败，请检查 API key 是否可用"));

    await processDirectGenerateTaskById("task1");

    expect(mocks.enqueueDirectGenerateTask).toHaveBeenCalledWith("task1", { jobId: "task1:retry:1" });
  });

  it("does not retry local missing-key errors", async () => {
    mocks.generateImages.mockRejectedValue(new Error("未配置 OPENAI_API_KEY"));

    await processDirectGenerateTaskById("task1");

    expect(mocks.enqueueDirectGenerateTask).not.toHaveBeenCalled();
    expect(mocks.tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "GENERATION_REFUND",
        amount: 40,
      }),
    });
    expect(mocks.tx.generationTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({
        status: "FAILED",
        retryCount: { increment: 1 },
      }),
    });
  });
});
