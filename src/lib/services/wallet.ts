import { CreditGrantSource, CreditTransactionType, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

type TxClient = Prisma.TransactionClient;

async function getWalletOrThrow(tx: TxClient, userId: string) {
  const wallet = await tx.wallet.findUnique({ where: { userId } });
  if (!wallet) throw new Error("钱包不存在");
  return wallet;
}

function activeGrantWhere(userId: string, now = new Date()): Prisma.CreditGrantWhereInput {
  return {
    userId,
    remaining: { gt: 0 },
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

async function getActiveGrantRemaining(tx: TxClient, userId: string, now = new Date()) {
  const aggregate = await tx.creditGrant.aggregate({
    where: activeGrantWhere(userId, now),
    _sum: { remaining: true },
  });

  return aggregate._sum.remaining ?? 0;
}

async function getTotalBalanceAfter(tx: TxClient, userId: string, now = new Date()) {
  const wallet = await getWalletOrThrow(tx, userId);
  const temporary = await getActiveGrantRemaining(tx, userId, now);
  return {
    permanent: wallet.balance,
    temporary,
    total: wallet.balance + temporary,
  };
}

export async function getAvailableCreditBalance(userId: string) {
  return prisma.$transaction((tx) => getTotalBalanceAfter(tx, userId));
}

export async function getCreditGrantSummaryByUserIds(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { temporary: number; earliestExpiresAt: Date | null }>();

  const now = new Date();
  const [sums, grants] = await Promise.all([
    prisma.creditGrant.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        remaining: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      _sum: { remaining: true },
    }),
    prisma.creditGrant.findMany({
      where: {
        userId: { in: userIds },
        remaining: { gt: 0 },
        expiresAt: { gt: now },
      },
      orderBy: { expiresAt: "asc" },
      select: { userId: true, expiresAt: true },
    }),
  ]);

  const summary = new Map<string, { temporary: number; earliestExpiresAt: Date | null }>();
  for (const item of sums) {
    summary.set(item.userId, {
      temporary: item._sum.remaining ?? 0,
      earliestExpiresAt: null,
    });
  }
  for (const grant of grants) {
    const current = summary.get(grant.userId) ?? { temporary: 0, earliestExpiresAt: null };
    if (!current.earliestExpiresAt) current.earliestExpiresAt = grant.expiresAt;
    summary.set(grant.userId, current);
  }

  return summary;
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

    const balance = await getTotalBalanceAfter(tx, input.userId);

    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: input.type,
        amount: input.amount,
        balanceAfter: balance.total,
        relatedTaskId: input.relatedTaskId,
        relatedCodeId: input.relatedCodeId,
        note: input.note,
      },
    });

    return { balanceAfter: balance.total, transaction };
  });
}

export async function grantTemporaryCredits(input: {
  userId: string;
  amount: number;
  expiresAt: Date;
  note: string;
  adminUserId?: string;
  campaignId?: string;
  source?: CreditGrantSource;
  transactionType?: CreditTransactionType;
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("短期积分必须大于 0");
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) throw new Error("过期时间不合法");
  if (input.expiresAt <= new Date()) throw new Error("过期时间必须晚于当前时间");

  return prisma.$transaction(async (tx) => {
    const grant = await tx.creditGrant.create({
      data: {
        userId: input.userId,
        amount: input.amount,
        remaining: input.amount,
        source: input.source ?? "ADMIN_GRANT",
        campaignId: input.campaignId,
        expiresAt: input.expiresAt,
        note: input.note,
        createdById: input.adminUserId,
      },
    });
    const balance = await getTotalBalanceAfter(tx, input.userId);
    const transaction = await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: input.transactionType ?? "TEMPORARY_GRANT",
        amount: input.amount,
        balanceAfter: balance.total,
        note: `${input.note}（短期积分，有效期至 ${input.expiresAt.toISOString()}）`,
      },
    });

    return { grant, transaction, balanceAfter: balance.total };
  });
}

export async function createCreditCampaignWithGrants(input: {
  name: string;
  description?: string;
  creditAmount: number;
  expiresAt: Date;
  userIds: string[];
  adminUserId: string;
}) {
  const uniqueUserIds = [...new Set(input.userIds.map((id) => id.trim()).filter(Boolean))];
  if (!input.name.trim()) throw new Error("活动名称不能为空");
  if (!Number.isInteger(input.creditAmount) || input.creditAmount <= 0) throw new Error("活动积分必须大于 0");
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) throw new Error("活动过期时间不合法");
  if (input.expiresAt <= new Date()) throw new Error("活动过期时间必须晚于当前时间");
  if (uniqueUserIds.length === 0) throw new Error("请选择发放用户");

  return prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { id: { in: uniqueUserIds }, status: "ACTIVE" },
      select: { id: true },
    });
    if (users.length === 0) throw new Error("没有可发放的有效用户");

    const campaign = await tx.creditCampaign.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        creditAmount: input.creditAmount,
        expiresAt: input.expiresAt,
        createdById: input.adminUserId,
      },
    });

    await tx.creditGrant.createMany({
      data: users.map((user) => ({
        userId: user.id,
        amount: input.creditAmount,
        remaining: input.creditAmount,
        source: "CAMPAIGN",
        campaignId: campaign.id,
        expiresAt: input.expiresAt,
        note: campaign.name,
        createdById: input.adminUserId,
      })),
    });

    await Promise.all(
      users.map(async (user) => {
        const balance = await getTotalBalanceAfter(tx, user.id);
        await tx.creditTransaction.create({
          data: {
            userId: user.id,
            type: "CAMPAIGN_GRANT",
            amount: input.creditAmount,
            balanceAfter: balance.total,
            note: `活动积分：${campaign.name}`,
          },
        });
      }),
    );

    return { campaign, grantedCount: users.length };
  });
}

export async function debitCreditsForTask(input: {
  tx: TxClient;
  userId: string;
  amount: number;
  taskId: string;
  note: string;
}) {
  if (input.amount <= 0) throw new Error("扣费金额不合法");

  const now = new Date();
  const wallet = await getWalletOrThrow(input.tx, input.userId);
  const grants = await input.tx.creditGrant.findMany({
    where: activeGrantWhere(input.userId, now),
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: { id: true, remaining: true },
  });
  const temporaryTotal = grants.reduce((sum, grant) => sum + grant.remaining, 0);
  if (temporaryTotal + wallet.balance < input.amount) {
    throw new Error(`余额不足，需要 ${input.amount} 积分`);
  }

  let remainingToDebit = input.amount;
  const usages: Array<{ grantId: string; amount: number }> = [];

  for (const grant of grants) {
    if (remainingToDebit <= 0) break;
    const used = Math.min(grant.remaining, remainingToDebit);
    await input.tx.creditGrant.update({
      where: { id: grant.id },
      data: { remaining: { decrement: used } },
    });
    usages.push({ grantId: grant.id, amount: used });
    remainingToDebit -= used;
  }

  if (remainingToDebit > 0) {
    await input.tx.wallet.update({
      where: { userId: input.userId },
      data: { balance: { decrement: remainingToDebit } },
    });
  }

  const balance = await getTotalBalanceAfter(input.tx, input.userId);
  const transaction = await input.tx.creditTransaction.create({
    data: {
      userId: input.userId,
      type: "GENERATION_DEBIT",
      amount: -input.amount,
      balanceAfter: balance.total,
      relatedTaskId: input.taskId,
      note: input.note,
    },
  });

  if (usages.length > 0) {
    await input.tx.creditGrantUsage.createMany({
      data: usages.map((usage) => ({
        grantId: usage.grantId,
        transactionId: transaction.id,
        taskId: input.taskId,
        amount: usage.amount,
      })),
    });
  }

  return { balanceAfter: balance.total, transaction };
}

export async function refundCreditsForTask(input: {
  tx: TxClient;
  userId: string;
  amount: number;
  taskId: string;
  note: string;
}) {
  if (input.amount <= 0) throw new Error("退款金额不合法");

  const usages = await input.tx.creditGrantUsage.findMany({
    where: { taskId: input.taskId },
    orderBy: { createdAt: "asc" },
    select: { grantId: true, amount: true },
  });
  const grantRefund = usages.reduce((sum, usage) => sum + usage.amount, 0);

  for (const usage of usages) {
    await input.tx.creditGrant.update({
      where: { id: usage.grantId },
      data: { remaining: { increment: usage.amount } },
    });
  }

  const permanentRefund = Math.max(0, input.amount - grantRefund);
  if (permanentRefund > 0) {
    await input.tx.wallet.update({
      where: { userId: input.userId },
      data: { balance: { increment: permanentRefund } },
    });
  }

  const balance = await getTotalBalanceAfter(input.tx, input.userId);
  const transaction = await input.tx.creditTransaction.create({
    data: {
      userId: input.userId,
      type: "GENERATION_REFUND",
      amount: input.amount,
      balanceAfter: balance.total,
      relatedTaskId: input.taskId,
      note: input.note,
    },
  });

  return { balanceAfter: balance.total, transaction };
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

    if (redeemCode.creditType === "TEMPORARY") {
      const expiresAt = new Date(Date.now() + (redeemCode.grantExpiresInHours ?? 24) * 60 * 60 * 1000);
      await tx.creditGrant.create({
        data: {
          userId: input.userId,
          amount: redeemCode.creditAmount,
          remaining: redeemCode.creditAmount,
          source: "REDEEM_CODE",
          expiresAt,
          note: `短期兑换码 ${redeemCode.code}`,
        },
      });
    } else {
      await tx.wallet.update({
        where: { userId: input.userId },
        data: { balance: { increment: redeemCode.creditAmount } },
      });
    }
    const balance = await getTotalBalanceAfter(tx, input.userId);

    await tx.creditTransaction.create({
      data: {
        userId: input.userId,
        type: "REDEEM_CODE",
        amount: redeemCode.creditAmount,
        balanceAfter: balance.total,
        relatedCodeId: redeemCode.id,
        note: redeemCode.creditType === "TEMPORARY"
          ? `兑换短期卡密 ${redeemCode.code}，有效 ${redeemCode.grantExpiresInHours ?? 24} 小时`
          : `兑换卡密 ${redeemCode.code}`,
      },
    });

    return { nextBalance: balance.total, redeemCode };
  });
}
