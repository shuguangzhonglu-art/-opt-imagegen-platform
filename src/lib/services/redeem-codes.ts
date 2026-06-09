import crypto from "node:crypto";

import { prisma } from "@/lib/db";

export function buildRedeemCode() {
  const batch = crypto.randomBytes(4).toString("hex").toUpperCase();
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `FC-${batch}-${random}`;
}

export async function generateRedeemCodes(input: {
  batchName: string;
  creditAmount: number;
  creditType?: "PERMANENT" | "TEMPORARY";
  grantExpiresInHours?: number | null;
  quantity: number;
  expiresAt?: Date | null;
  adminUserId: string;
}) {
  const codes = Array.from({ length: input.quantity }, () => ({
    code: buildRedeemCode(),
    batchName: input.batchName,
    creditAmount: input.creditAmount,
    creditType: input.creditType ?? "PERMANENT",
    grantExpiresInHours: input.creditType === "TEMPORARY" ? input.grantExpiresInHours ?? 24 : null,
    expiresAt: input.expiresAt ?? null,
    createdById: input.adminUserId,
  }));

  await prisma.redeemCode.createMany({ data: codes });
  return codes;
}
