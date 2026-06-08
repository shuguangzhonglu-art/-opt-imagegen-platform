import { CreditTransactionType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

type TxClient = Prisma.TransactionClient;

async function getWalletOrThrow(tx: TxClient, userId: string) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error("钱包不存在");
  return wallet;
}

export async function adjustWalletBalance(input: {
  userId: string;
  amount: number;
  type: CreditTransactionType;
  note: string;
  relatedTaskId?: string;
  relatedCodeId?: string;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.amount < 0) {
      const updated = await tx.wallet.updateMany({
        where: {
          userId: input.userId,
          balance: { gte: Math.abs(input.amount) },
        },
        data: { balance: { increment: input.amount } },
      });
      if (updated.count !== 1) throw new Error("积分不足");
    } else {
      await tx.wallet.update({
        where: { userId: input.userId },
        data: { balance: { increment: input.amount } },
      });
    }

    const wallet = await getWalletOrThrow(tx, input.userId);

    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        balanceAfter: wallet.balance,
        relatedTaskId: input.relatedTaskId,
        relatedCodeId: input.relatedCodeId,
        note: input.note,
      },
    });

    return { balanceAfter: wallet.balance, transaction };
  });
}

export async function redeemCodeForUser(input: { userId: string; code: string }) {
  return prisma.$transaction(async (tx) => {
    const redeemCode = await tx.redeemCode.findUnique({
      where: { code: input.code },
    });

    if (!redeemCode) throw new Error("卡密不存在");
    if (redeemCode.status !== "UNUSED") throw new Error("卡密不可用");
    if (redeemCode.expiresAt && redeemCode.expiresAt < new Date()) {
      await tx.redeemCode.update({
        where: { id: redeemCode.id },
        data: { status: "EXPIRED" },
      });
      throw new Error("卡密已过期");
    }

    const claimed = await tx.redeemCode.updateMany({
      where: {
        id: redeemCode.id,
        status: "UNUSED",
        redeemedAt: null,
      },
      data: {
        status: "REDEEMED",
        redeemedAt: new Date(),
        redeemedById: input.userId,
      },
    });

    if (claimed.count !== 1) throw new Error("卡密不可用");

    const wallet = await tx.wallet.update({
      where: { userId: input.userId },
      data: { balance: { increment: redeemCode.creditAmount } },
    });

    await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: "REDEEM_CODE",
        amount: redeemCode.creditAmount,
        balanceAfter: wallet.balance,
        relatedCodeId: redeemCode.id,
        note: `兑换卡密 ${redeemCode.code}`,
      },
    });

    return { nextBalance: wallet.balance, redeemCode };
  });
}
