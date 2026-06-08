import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    wallet: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

import { adjustWalletBalance, redeemCodeForUser } from "./wallet";

describe("wallet service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
