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
  return value.trim().replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-").slice(0, 80) || "invite-codes";
}

export async function GET(request: Request) {
  await requireAdmin();

  const { searchParams } = new URL(request.url);
  const batch = searchParams.get("batch")?.trim();
  const status = searchParams.get("status")?.trim();

  const where: Prisma.RegistrationInviteCodeWhereInput = {
    batchName: batch || undefined,
    status:
      status && status !== "ALL" && ["ACTIVE", "DISABLED"].includes(status)
        ? status as "ACTIVE" | "DISABLED"
        : undefined,
  };

  const codes = await prisma.registrationInviteCode.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { email: true, displayName: true } },
      uses: {
        include: {
          user: { select: { email: true, displayName: true } },
        },
        orderBy: { usedAt: "desc" },
      },
    },
  });

  const rows = [
    csvLine(["邀请码", "批次", "状态", "已用次数", "最大次数", "过期时间", "创建时间", "创建人", "被邀请用户", "使用时间", "备注"]),
    ...codes.map((code) => {
      const latestUse = code.uses[0];
      return csvLine([
        code.code,
        code.batchName,
        code.status,
        code.usedCount,
        code.maxUses,
        code.expiresAt ? formatDateTime(code.expiresAt) : "永不过期",
        formatDateTime(code.createdAt),
        code.createdBy?.displayName ?? code.createdBy?.email ?? "",
        latestUse?.user.email ?? latestUse?.user.displayName ?? "",
        latestUse ? formatDateTime(latestUse.usedAt) : "",
        code.note,
      ]);
    }),
  ];

  const csv = `\uFEFF${rows.join("\n")}\n`;
  const fileName = `${filenamePart(batch || "all-invite-codes")}-${status || "ALL"}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
