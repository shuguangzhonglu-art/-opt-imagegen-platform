import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    user: {
      findMany: vi.fn(),
    },
    wallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    creditGrant: {
      aggregate: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    creditCampaign: {
      create: vi.fn(),
    },
    creditGrantUsage: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    creditTransaction: {
      create: vi.fn(),
    },
    redeemCode: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  return {
    tx,
    prisma: {
      $transaction: vi.fn((callback: (txClient: typeof tx) => unknown) => callback(tx)),
    },
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

import { adjustWalletBalance, createCreditCampaignWithGrants, debitCreditsForTask, grantTemporaryCredits, redeemCodeForUser, refundCreditsForTask } from "./wallet";

describe("wallet service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.creditGrant.aggregate.mockResolvedValue({ _sum: { remaining: 0 } });
  });

  it("records an admin credit adjustment with the updated balance", async () => {
    mocks.tx.wallet.update.mockResolvedValue({ userId: "u1", balance: 150 });
    mocks.tx.wallet.findUnique.mockResolvedValue({ userId: "u1", balance: 150 });
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "t1" });

    const result = await adjustWalletBalance({
      userId: "u1",
      amount: 50,
      type: "ADMIN_ADJUSTMENT",
      note: "test",
    });

    expect(mocks.tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { balance: { increment: 50 } },
    });
    expect(result.balanceAfter).toBe(150);
    expect(mocks.tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: 50,
        balanceAfter: 150,
      }),
    });
  });

  it("refuses a negative adjustment when the wallet has insufficient balance", async () => {
    mocks.tx.wallet.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      adjustWalletBalance({
        userId: "u1",
        amount: -200,
        type: "ADMIN_ADJUSTMENT",
        note: "test",
      }),
    ).rejects.toThrow("积分不足");

    expect(mocks.tx.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("claims a redeem code atomically before increasing wallet balance", async () => {
    mocks.tx.redeemCode.findUnique.mockResolvedValue({
      id: "c1",
      code: "FC-TEST-CODE",
      status: "UNUSED",
      creditAmount: 100,
      expiresAt: null,
    });
    mocks.tx.redeemCode.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.wallet.update.mockResolvedValue({ userId: "u1", balance: 300 });
    mocks.tx.wallet.findUnique.mockResolvedValue({ userId: "u1", balance: 300 });
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "t1" });

    const result = await redeemCodeForUser({ userId: "u1", code: "FC-TEST-CODE" });

    expect(mocks.tx.redeemCode.updateMany).toHaveBeenCalledWith({
      where: {
        id: "c1",
        status: "UNUSED",
        redeemedAt: null,
      },
      data: expect.objectContaining({
        status: "REDEEMED",
        redeemedById: "u1",
      }),
    });
    expect(result.nextBalance).toBe(300);
  });

  it("debits temporary grants first and falls back to permanent balance", async () => {
    mocks.tx.wallet.findUnique.mockResolvedValue({ userId: "u1", balance: 80 });
    mocks.tx.creditGrant.findMany.mockResolvedValue([
      { id: "g1", remaining: 30 },
      { id: "g2", remaining: 50 },
    ]);
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "tx1" });
    mocks.tx.creditGrant.aggregate.mockResolvedValue({ _sum: { remaining: 10 } });

    const result = await debitCreditsForTask({
      tx: mocks.tx as never,
      userId: "u1",
      amount: 70,
      taskId: "task1",
      note: "图片生成",
    });

    expect(mocks.tx.creditGrant.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { remaining: { decrement: 30 } },
    });
    expect(mocks.tx.creditGrant.update).toHaveBeenCalledWith({
      where: { id: "g2" },
      data: { remaining: { decrement: 40 } },
    });
    expect(mocks.tx.wallet.update).not.toHaveBeenCalled();
    expect(mocks.tx.creditGrantUsage.createMany).toHaveBeenCalledWith({
      data: [
        { grantId: "g1", transactionId: "tx1", taskId: "task1", amount: 30 },
        { grantId: "g2", transactionId: "tx1", taskId: "task1", amount: 40 },
      ],
    });
    expect(result.balanceAfter).toBe(90);
  });

  it("refunds task credits back to the original temporary grant before permanent balance", async () => {
    mocks.tx.wallet.findUnique.mockResolvedValue({ userId: "u1", balance: 20 });
    mocks.tx.creditGrantUsage.findMany.mockResolvedValue([{ grantId: "g1", amount: 40 }]);
    mocks.tx.creditGrant.aggregate.mockResolvedValue({ _sum: { remaining: 40 } });
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "tx2" });

    const result = await refundCreditsForTask({
      tx: mocks.tx as never,
      userId: "u1",
      amount: 70,
      taskId: "task1",
      note: "失败退款",
    });

    expect(mocks.tx.creditGrant.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { remaining: { increment: 40 } },
    });
    expect(mocks.tx.wallet.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { balance: { increment: 30 } },
    });
    expect(result.balanceAfter).toBe(60);
  });

  it("does not credit the wallet if another request already claimed the code", async () => {
    mocks.tx.redeemCode.findUnique.mockResolvedValue({
      id: "c1",
      code: "FC-TEST-CODE",
      status: "UNUSED",
      creditAmount: 100,
      expiresAt: null,
    });
    mocks.tx.redeemCode.updateMany.mockResolvedValue({ count: 0 });

    await expect(redeemCodeForUser({ userId: "u1", code: "FC-TEST-CODE" })).rejects.toThrow("卡密不可用");

    expect(mocks.tx.wallet.update).not.toHaveBeenCalled();
    expect(mocks.tx.creditTransaction.create).not.toHaveBeenCalled();
  });

  it("records a dedicated transaction type when granting temporary credits", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    mocks.tx.creditGrant.create.mockResolvedValue({ id: "g1" });
    mocks.tx.wallet.findUnique.mockResolvedValue({ userId: "u1", balance: 20 });
    mocks.tx.creditGrant.aggregate.mockResolvedValue({ _sum: { remaining: 30 } });
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "tx3" });

    const result = await grantTemporaryCredits({
      userId: "u1",
      amount: 30,
      expiresAt,
      note: "上线活动",
      adminUserId: "admin1",
    });

    expect(mocks.tx.creditGrant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        amount: 30,
        remaining: 30,
        source: "ADMIN_GRANT",
        expiresAt,
      }),
    });
    expect(mocks.tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "TEMPORARY_GRANT",
        amount: 30,
        balanceAfter: 50,
      }),
    });
    expect(result.balanceAfter).toBe(50);
  });

  it("records campaign grants with a dedicated transaction type", async () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mocks.tx.user.findMany.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
    mocks.tx.creditCampaign.create.mockResolvedValue({ id: "camp1", name: "上线活动" });
    mocks.tx.creditGrant.createMany.mockResolvedValue({ count: 2 });
    mocks.tx.wallet.findUnique
      .mockResolvedValueOnce({ userId: "u1", balance: 10 })
      .mockResolvedValueOnce({ userId: "u2", balance: 20 });
    mocks.tx.creditGrant.aggregate
      .mockResolvedValueOnce({ _sum: { remaining: 40 } })
      .mockResolvedValueOnce({ _sum: { remaining: 40 } });
    mocks.tx.creditTransaction.create.mockResolvedValue({ id: "tx4" });

    const result = await createCreditCampaignWithGrants({
      name: "上线活动",
      creditAmount: 40,
      expiresAt,
      userIds: ["u1", "u2", "u1"],
      adminUserId: "admin1",
    });

    expect(mocks.tx.creditGrant.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "u1", source: "CAMPAIGN", amount: 40, remaining: 40 }),
        expect.objectContaining({ userId: "u2", source: "CAMPAIGN", amount: 40, remaining: 40 }),
      ],
    });
    expect(mocks.tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u1",
        type: "CAMPAIGN_GRANT",
        amount: 40,
        balanceAfter: 50,
      }),
    });
    expect(mocks.tx.creditTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "u2",
        type: "CAMPAIGN_GRANT",
        amount: 40,
        balanceAfter: 60,
      }),
    });
    expect(result.grantedCount).toBe(2);
  });
});
