import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

type TxClient = Prisma.TransactionClient;
const USER_INVITE_LIMIT = 5;

export function buildRegistrationInviteCode() {
  const batch = crypto.randomBytes(3).toString("hex").toUpperCase();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `INV-${batch}-${random}`;
}

export async function generateRegistrationInviteCodes(input: {
  batchName: string;
  quantity: number;
  maxUses: number;
  expiresAt?: Date | null;
  note?: string;
  adminUserId: string;
}) {
  if (!input.batchName.trim()) throw new Error("批次名称不能为空");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 500) throw new Error("邀请码数量不合法");
  if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > 10000) throw new Error("使用次数不合法");

  const codes = Array.from({ length: input.quantity }, () => ({
    code: buildRegistrationInviteCode(),
    batchName: input.batchName.trim(),
    maxUses: input.maxUses,
    expiresAt: input.expiresAt ?? null,
    note: input.note?.trim() ?? "",
    createdById: input.adminUserId,
  }));

  await prisma.registrationInviteCode.createMany({ data: codes });
  return codes;
}

export async function getOrCreateUserInviteCodes(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

    const existing = await tx.registrationInviteCode.findMany({
      where: {
        createdById: userId,
        batchName: "用户邀请",
      },
      orderBy: { createdAt: "asc" },
      include: {
        uses: {
          include: {
            user: {
              select: {
                email: true,
                displayName: true,
              },
            },
          },
          orderBy: { usedAt: "desc" },
        },
      },
    });

    const missing = Math.max(0, USER_INVITE_LIMIT - existing.length);
    if (missing > 0) {
      await tx.registrationInviteCode.createMany({
        data: Array.from({ length: missing }, () => ({
          code: buildRegistrationInviteCode(),
          batchName: "用户邀请",
          maxUses: 1,
          note: "用户邀请名额",
          createdById: userId,
        })),
      });
    }

    if (missing === 0) return existing;

    return tx.registrationInviteCode.findMany({
      where: {
        createdById: userId,
        batchName: "用户邀请",
      },
      orderBy: { createdAt: "asc" },
      include: {
        uses: {
          include: {
            user: {
              select: {
                email: true,
                displayName: true,
              },
            },
          },
          orderBy: { usedAt: "desc" },
        },
      },
    });
  });
}

export async function claimRegistrationInviteCode(tx: TxClient, codeValue: string, userId: string) {
  const normalizedCode = codeValue.trim().toUpperCase();
  if (!normalizedCode) throw new Error("请输入邀请码");

  const invite = await tx.registrationInviteCode.findUnique({
    where: { code: normalizedCode },
  });

  if (!invite) throw new Error("邀请码不存在");
  if (invite.status !== "ACTIVE") throw new Error("邀请码不可用");
  if (invite.expiresAt && invite.expiresAt < new Date()) throw new Error("邀请码已过期");
  if (invite.usedCount >= invite.maxUses) throw new Error("邀请码已用完");

  const claimed = await tx.registrationInviteCode.updateMany({
    where: {
      id: invite.id,
      status: "ACTIVE",
      usedCount: { lt: invite.maxUses },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: {
      usedCount: { increment: 1 },
    },
  });

  if (claimed.count !== 1) throw new Error("邀请码已用完");

  await tx.registrationInviteCodeUse.create({
    data: {
      codeId: invite.id,
      userId,
    },
  });

  return invite;
}
