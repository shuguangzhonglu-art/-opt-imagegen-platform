import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { Notice } from "@/components/notice";
import { disableRegistrationInviteCodeAction, generateRegistrationInviteCodesAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

type InviteCodesPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    status?: string;
    batch?: string;
    search?: string;
  }>;
};

const validStatuses = ["ALL", "ACTIVE", "DISABLED"] as const;

function isExpired(code: { expiresAt: Date | null }) {
  return code.expiresAt !== null && code.expiresAt.getTime() < Date.now();
}

function isAvailable(code: { status: string; usedCount: number; maxUses: number; expiresAt: Date | null }) {
  return code.status === "ACTIVE" && code.usedCount < code.maxUses && !isExpired(code);
}

function downloadHref(input?: { batchName?: string; status?: string }) {
  const params = new URLSearchParams();
  if (input?.batchName) params.set("batch", input.batchName);
  if (input?.status) params.set("status", input.status);
  const query = params.toString();
  return `/admin/invite-codes/download${query ? `?${query}` : ""}`;
}

export default async function AdminInviteCodesPage({ searchParams }: InviteCodesPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const status = validStatuses.includes(params.status as typeof validStatuses[number]) ? params.status! : "ALL";
  const batch = params.batch || "ALL";
  const search = params.search?.trim();

  const where: Prisma.RegistrationInviteCodeWhereInput = {
    status: status !== "ALL" ? status as "ACTIVE" | "DISABLED" : undefined,
    batchName: batch !== "ALL" ? batch : undefined,
    OR: search
      ? [
          { code: { contains: search, mode: "insensitive" } },
          { batchName: { contains: search, mode: "insensitive" } },
          { createdBy: { email: { contains: search, mode: "insensitive" } } },
        ]
      : undefined,
  };

  const [codes, allCodes, batches] = await Promise.all([
    prisma.registrationInviteCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        createdBy: { select: { id: true, email: true, displayName: true } },
        uses: {
          include: {
            user: { select: { id: true, email: true, displayName: true } },
          },
          orderBy: { usedAt: "desc" },
        },
      },
    }),
    prisma.registrationInviteCode.findMany({
      select: { id: true, batchName: true, status: true, usedCount: true, maxUses: true, expiresAt: true },
    }),
    prisma.registrationInviteCode.findMany({
      distinct: ["batchName"],
      select: { batchName: true },
      orderBy: { batchName: "asc" },
    }),
  ]);

  const availableCount = allCodes.filter(isAvailable).length;
  const usedUpCount = allCodes.filter((code) => code.usedCount >= code.maxUses).length;
  const disabledCount = allCodes.filter((code) => code.status === "DISABLED").length;
  const expiredCount = allCodes.filter((code) => code.status === "ACTIVE" && isExpired(code)).length;
  const cards = [
    { label: "邀请码总数", value: formatNumber(allCodes.length), note: "含用户邀请和后台批次" },
    { label: "可用", value: formatNumber(availableCount), note: "未过期且未用完" },
    { label: "已用完", value: formatNumber(usedUpCount), note: "一次性码用完后不可再用" },
    { label: "已禁用", value: formatNumber(disabledCount), note: "管理员关闭" },
    { label: "已过期", value: formatNumber(expiredCount), note: "仍为 ACTIVE 但已过期" },
  ];

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>注册邀请码</h1>
          <p>管理注册准入邀请码。普通用户自动拥有 5 个一次性邀请名额。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{admin.email.charAt(0).toUpperCase()}</span>
          <span>
            <strong>{admin.displayName ?? admin.email}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/security" className="ghost-button compact">安全配置</Link>
          <Link href="/admin/users" className="ghost-button compact">用户管理</Link>
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="usage-summary-grid">
        {cards.map((card) => (
          <article className="usage-summary-card" key={card.label}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="usage-dashboard-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>生成后台邀请码</h2>
              <p>适合活动、人工审核或客服发放。用户自己的 5 个码会自动生成。</p>
            </div>
          </header>
          <form action={generateRegistrationInviteCodesAction} className="usage-detail-body redeem-inline-form">
            <label>
              <span>批次</span>
              <input name="batchName" type="text" defaultValue="后台邀请" required />
            </label>
            <label>
              <span>数量</span>
              <input name="quantity" type="number" min="1" max="500" defaultValue="1" required />
            </label>
            <label>
              <span>每码可用次数</span>
              <input name="maxUses" type="number" min="1" max="10000" defaultValue="1" required />
            </label>
            <label>
              <span>过期时间</span>
              <input name="expiresAt" type="datetime-local" />
            </label>
            <label className="campaign-wide-field">
              <span>备注</span>
              <input name="note" type="text" placeholder="内部备注" />
            </label>
            <button type="submit" className="primary-button compact">生成</button>
          </form>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>筛选</h2>
              <p>按批次、状态、创建人或邀请码查询。</p>
            </div>
          </header>
          <form className="usage-detail-body redeem-inline-form">
            <label>
              <span>搜索</span>
              <input name="search" type="search" defaultValue={params.search || ""} placeholder="邀请码 / 批次 / 创建人邮箱" />
            </label>
            <label>
              <span>状态</span>
              <select name="status" defaultValue={status}>
                <option value="ALL">全部状态</option>
                <option value="ACTIVE">启用</option>
                <option value="DISABLED">禁用</option>
              </select>
            </label>
            <label>
              <span>批次</span>
              <select name="batch" defaultValue={batch}>
                <option value="ALL">全部批次</option>
                {batches.map((item) => (
                  <option key={item.batchName} value={item.batchName}>{item.batchName}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="primary-button compact">筛选</button>
          </form>
        </article>
      </section>

      <section className="usage-records">
        <header>
          <div>
            <h2>邀请码明细</h2>
            <p>最多展示当前筛选条件下最近 500 条。</p>
          </div>
          <div className="toolbar-actions">
            <Link href={downloadHref({ batchName: batch !== "ALL" ? batch : undefined, status })} className="ghost-button compact">下载当前结果</Link>
            <Link href="/admin/invite-codes" className="ghost-button compact">重置</Link>
          </div>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table transactions-table">
            <thead>
              <tr>
                <th>邀请码</th>
                <th>批次</th>
                <th>状态</th>
                <th>使用</th>
                <th>创建人</th>
                <th>被邀请用户</th>
                <th>创建时间</th>
                <th>过期时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr><td colSpan={9} className="usage-empty-cell">暂无邀请码</td></tr>
              ) : codes.map((code) => {
                const latestUse = code.uses[0];
                const available = isAvailable(code);
                return (
                  <tr key={code.id}>
                    <td><code className="redeem-code-text">{code.code}</code></td>
                    <td>{code.batchName}</td>
                    <td><span className={available ? "status-dot ok" : "status-dot muted"}>{available ? "可用" : code.status === "DISABLED" ? "已禁用" : isExpired(code) ? "已过期" : "已用完"}</span></td>
                    <td>{formatNumber(code.usedCount)} / {formatNumber(code.maxUses)}</td>
                    <td>
                      {code.createdBy ? (
                        <Link className="usage-user-link" href={`/admin/users/${code.createdBy.id}`}>
                          <strong>{code.createdBy.email}</strong>
                          <small>{code.createdBy.displayName ?? "未设置"}</small>
                        </Link>
                      ) : "—"}
                    </td>
                    <td>
                      {latestUse ? (
                        <Link className="usage-user-link" href={`/admin/users/${latestUse.user.id}`}>
                          <strong>{latestUse.user.email}</strong>
                          <small>{formatDateTime(latestUse.usedAt)}</small>
                        </Link>
                      ) : "—"}
                    </td>
                    <td>{formatDateTime(code.createdAt)}</td>
                    <td>{code.expiresAt ? formatDateTime(code.expiresAt) : "永不过期"}</td>
                    <td>
                      {code.status === "ACTIVE" ? (
                        <form action={disableRegistrationInviteCodeAction}>
                          <input type="hidden" name="codeId" value={code.id} />
                          <button type="submit" className="icon-action">禁用</button>
                        </form>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
