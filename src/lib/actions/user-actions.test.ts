import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  prisma: {
    generatedImage: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
  normalizeStoredImageUrl: vi.fn((value: string) => `normalized:${value}`),
  getGeneratedImagePathCandidates: vi.fn((value: string) => [value, "/generated/demo.png", "generated/demo.png"]),
  deleteDirectHistoryByUserIdAndFilePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/services/direct-history", () => ({
  DIRECT_HISTORY_PAGE_SIZE: 20,
  deleteDirectHistoryByUserIdAndFilePath: mocks.deleteDirectHistoryByUserIdAndFilePath,
}));

vi.mock("@/lib/services/direct-tasks", () => ({
  deleteDirectGenerateTask: vi.fn(),
  getDirectGenerateTask: vi.fn(),
  getDirectGenerateTasksByUserId: vi.fn(),
  retryDirectGenerateTask: vi.fn(),
  startDirectGenerateTask: vi.fn(),
}));

vi.mock("@/lib/services/wallet", () => ({
  getAvailableCreditBalance: vi.fn(),
  redeemCodeForUser: vi.fn(),
}));

vi.mock("@/lib/services/object-storage", () => ({
  getGeneratedImagePathCandidates: mocks.getGeneratedImagePathCandidates,
  normalizeStoredImageUrl: mocks.normalizeStoredImageUrl,
}));

vi.mock("@/lib/utils/flash", () => ({
  withMessage: vi.fn(),
}));

import { deleteDirectHistoryItemAction, getDirectHistoryAction, getKvHistoryAction } from "./user-actions";

describe("user history actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1", email: "u@example.com", role: "USER" });
    mocks.prisma.generatedImage.deleteMany.mockResolvedValue({ count: 0 });
    mocks.deleteDirectHistoryByUserIdAndFilePath.mockResolvedValue(0);
    mocks.prisma.generatedImage.findMany.mockResolvedValue([
      {
        filePath: "https://cdn.hemasir.online/generated/demo.png",
        width: 1024,
        height: 1536,
        createdAt: new Date("2026-06-10T02:00:00.000Z"),
        task: {
          prompt: "一张产品主视觉",
          size: "1024x1536",
        },
      },
    ]);
  });

  it("loads only direct-task images for the normal studio history", async () => {
    const history = await getDirectHistoryAction({ offset: 5, limit: 7 });

    expect(mocks.prisma.generatedImage.findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        task: {
          style: "direct",
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
      skip: 5,
      take: 7,
    });
    expect(history).toEqual([
      {
        filePath: "normalized:https://cdn.hemasir.online/generated/demo.png",
        width: 1024,
        height: 1536,
        prompt: "一张产品主视觉",
        size: "1024x1536",
        createdAt: "2026-06-10T02:00:00.000Z",
      },
    ]);
  });

  it("loads only KV-task images for the KV history", async () => {
    await getKvHistoryAction();

    expect(mocks.prisma.generatedImage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          task: {
            style: "kv",
          },
        },
        skip: 0,
        take: 20,
      }),
    );
  });

  it("deletes a generated image using normalized path candidates for the current user", async () => {
    mocks.prisma.generatedImage.deleteMany.mockResolvedValue({ count: 1 });

    const result = await deleteDirectHistoryItemAction("https://cdn.hemasir.online/generated/demo.png");

    expect(result).toEqual({ success: true });
    expect(mocks.getGeneratedImagePathCandidates).toHaveBeenCalledWith("https://cdn.hemasir.online/generated/demo.png");
    expect(mocks.prisma.generatedImage.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        filePath: {
          in: ["https://cdn.hemasir.online/generated/demo.png", "/generated/demo.png", "generated/demo.png"],
        },
      },
    });
  });

  it("falls back to legacy direct history records when deleting old images", async () => {
    mocks.deleteDirectHistoryByUserIdAndFilePath
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const result = await deleteDirectHistoryItemAction("/generated/demo.png");

    expect(result).toEqual({ success: true });
    expect(mocks.deleteDirectHistoryByUserIdAndFilePath).toHaveBeenCalledWith("user-1", "/generated/demo.png");
  });

  it("returns a clear error when no matching image can be deleted", async () => {
    const result = await deleteDirectHistoryItemAction("/generated/missing.png");

    expect(result).toEqual({ success: false, error: "未找到可删除的记录" });
  });
});
