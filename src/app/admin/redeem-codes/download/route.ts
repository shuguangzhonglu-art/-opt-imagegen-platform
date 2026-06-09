import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `\t${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function csvLine(values: Array<string | number | null | undefined>) {
  return values.map(csvCell).join(",");
}

function filenamePart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-").slice(0, 80) || "redeem-codes";
}

export async function GET(request: Request) {
  await requireAdmin();

  const { searchParams } = new URL(request.url);
  const batch = searchParams.get("batch")?.trim();
  const status = searchParams.get("status")?.trim();

  const where: Prisma.RedeemCodeWhereInput = {
    batchName: batch || undefined,
    status:
      status && status !== "ALL" && ["UNUSED", "REDEEMED", "EXPIRED", "DISABLED"].includes(status)
        ? status as "UNUSED" | "REDEEMED" | "EXPIRED" | "DISABLED"
        : undefined,
  };

  const codes = await prisma.redeemCode.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      redeemedBy: {
        select: { email: true, displayName: true },
      },
      createdBy: {
        select: { email: true, displayName: true },
      },
    },
  });

  const rows = [
    csvLine(["兑换码", "批次", "面额", "状态", "过期时间", "创建时间", "创建人", "兑换时间", "兑换用户"]),
    ...codes.map((code) =>
      csvLine([
        code.code,
        code.batchName,
        code.creditAmount,
        code.status,
        code.expiresAt ? formatDateTime(code.expiresAt) : "永不过期",
        formatDateTime(code.createdAt),
        code.createdBy?.displayName ?? code.createdBy?.email ?? "",
        code.redeemedAt ? formatDateTime(code.redeemedAt) : "",
        code.redeemedBy?.email ?? code.redeemedBy?.displayName ?? "",
      ]),
    ),
  ];

  const csv = `\uFEFF${rows.join("\n")}\n`;
  const fileName = `${filenamePart(batch || "all-redeem-codes")}-${status || "ALL"}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
