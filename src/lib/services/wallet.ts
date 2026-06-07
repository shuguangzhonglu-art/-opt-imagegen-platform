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
    const wallet = await getWalletOrThrow(tx, input.userId);
    const nextBalance = wallet.balance + input.amount;

    if (nextBalance < 0) {
      throw new Error("积分不足");
    }

    await tx.wallet.update({
      where: { userId: input.userId },
      data: { balance: nextBalance },
    });

    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        balanceAfter: nextBalance,
        relatedTaskId: input.relatedTaskId,
        relatedCodeId: input.relatedCodeId,
        note: input.note,
      },
    });

    return { balanceAfter: nextBalance, transaction };
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

    const wallet = await getWalletOrThrow(tx, input.userId);
    const nextBalance = wallet.balance + redeemCode.creditAmount;

    await tx.wallet.update({
      where: { userId: input.userId },
      data: { balance: nextBalance },
    });

    await tx.redeemCode.update({
      where: { id: redeemCode.id },
      data: {
        status: "REDEEMED",
        redeemedAt: new Date(),
        redeemedById: input.userId,
      },
    });

    await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: "REDEEM_CODE",
        amount: redeemCode.creditAmount,
        balanceAfter: nextBalance,
        relatedCodeId: redeemCode.id,
        note: `兑换卡密 ${redeemCode.code}`,
      },
    });

    return { nextBalance, redeemCode };
  });
}
