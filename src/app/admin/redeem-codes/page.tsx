import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { Notice } from "@/components/notice";
import { disableRedeemCodeAction, generateRedeemCodesAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCodeStatus, formatDateTime, formatNumber } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type RedeemCodesPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    status?: string;
    batch?: string;
    search?: string;
  }>;
};

const validStatuses = ["ALL", "UNUSED", "REDEEMED", "EXPIRED", "DISABLED"] as const;
type RedeemCodeStatusFilter = Exclude<typeof validStatuses[number], "ALL">;

function isExpired(code: { status: string; expiresAt: Date | null }) {
  return code.status === "UNUSED" && code.expiresAt !== null && code.expiresAt.getTime() < Date.now();
}

function downloadHref(input?: { batchName?: string; status?: string }) {
  const params = new URLSearchParams();
  if (input?.batchName) params.set("batch", input.batchName);
  if (input?.status) params.set("status", input.status);
  const query = params.toString();
  return `/admin/redeem-codes/download${query ? `?${query}` : ""}`;
}

export default async function AdminRedeemCodesPage({ searchParams }: RedeemCodesPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const status = validStatuses.includes(params.status as typeof validStatuses[number]) ? params.status! : "ALL";
  const batch = params.batch || "ALL";
  const search = params.search?.trim();

  const where: Prisma.RedeemCodeWhereInput = {
    status: status !== "ALL" ? status as RedeemCodeStatusFilter : undefined,
    batchName: batch !== "ALL" ? batch : undefined,
    OR: search
      ? [
          { code: { contains: search, mode: "insensitive" } },
          { batchName: { contains: search, mode: "insensitive" } },
          { redeemedBy: { email: { contains: search, mode: "insensitive" } } },
        ]
      : undefined,
  };

  const [codes, allCodes, batches, wallet] = await Promise.all([
    prisma.redeemCode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        redeemedBy: {
          select: { id: true, email: true, displayName: true },
        },
        createdBy: {
          select: { email: true, displayName: true },
        },
        transactions: {
          select: { id: true },
        },
      },
    }),
    prisma.redeemCode.findMany({
      select: {
        id: true,
        batchName: true,
        creditAmount: true,
        status: true,
        expiresAt: true,
      },
    }),
    prisma.redeemCode.findMany({
      distinct: ["batchName"],
      select: { batchName: true },
      orderBy: { batchName: "asc" },
    }),
    prisma.wallet.findUnique({ where: { userId: admin.id } }),
  ]);

  const totalFaceValue = codes.reduce((sum, code) => sum + code.creditAmount, 0);
  const allTotalFaceValue = allCodes.reduce((sum, code) => sum + code.creditAmount, 0);
  const unusedCount = allCodes.filter((code) => code.status === "UNUSED" && !isExpired(code)).length;
  const redeemedCount = allCodes.filter((code) => code.status === "REDEEMED").length;
  const disabledCount = allCodes.filter((code) => code.status === "DISABLED").length;
  const expiredCount = allCodes.filter(isExpired).length;
  const batchStats = [...allCodes.reduce((map, code) => {
    const current = map.get(code.batchName) ?? {
      batchName: code.batchName,
      total: 0,
      faceValue: 0,
      redeemed: 0,
      unused: 0,
      disabled: 0,
      expired: 0,
    };
    current.total += 1;
    current.faceValue += code.creditAmount;
    if (code.status === "REDEEMED") current.redeemed += 1;
    if (code.status === "DISABLED") current.disabled += 1;
    if (isExpired(code)) current.expired += 1;
    if (code.status === "UNUSED" && !isExpired(code)) current.unused += 1;
    map.set(code.batchName, current);
    return map;
  }, new Map<string, {
    batchName: string;
    total: number;
    faceValue: number;
    redeemed: number;
    unused: number;
    disabled: number;
    expired: number;
  }>()).values()].sort((a, b) => b.total - a.total).slice(0, 8);

  const cards = [
    { label: "兑换码总数", value: formatNumber(allCodes.length), note: "全部批次" },
    { label: "未使用", value: formatNumber(unusedCount), note: "可兑换库存" },
    { label: "已兑换", value: formatNumber(redeemedCount), note: "已被用户使用" },
    { label: "已作废", value: formatNumber(disabledCount), note: "管理员禁用" },
    { label: "已过期", value: formatNumber(expiredCount), note: "未用且过期" },
    { label: "当前筛选面额", value: formatNumber(totalFaceValue), note: `全部面额 ${formatNumber(allTotalFaceValue)}` },
  ];

  function adminInitial(email: string) {
    return email.trim().charAt(0).toUpperCase();
  }

  function displayStatus(code: { status: string; expiresAt: Date | null }) {
    if (isExpired(code)) return "已过期";
    return formatCodeStatus(code.status);
  }

  function statusTone(code: { status: string; expiresAt: Date | null }) {
    if (isExpired(code)) return "muted";
    if (code.status === "UNUSED") return "green";
    if (code.status === "REDEEMED") return "admin";
    return "";
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>兑换码管理</h1>
          <p>按批次、状态、面额和兑换用户管理积分兑换码。</p>
        </div>
        <div className="sub-admin-account">
          <span className="balance-pill">{formatNumber(wallet?.balance ?? 0)} 积分</span>
          <span className="admin-avatar">{adminInitial(admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? admin.email.split("@")[0]}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/transactions" className="ghost-button compact">积分流水</Link>
          <Link href="/admin/audit-logs" className="ghost-button compact">操作日志</Link>
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

      <form className="usage-filters redeem-filters">
        <label>
          <span>搜索</span>
          <input name="search" type="search" placeholder="兑换码 / 批次 / 用户邮箱" defaultValue={params.search || ""} />
        </label>
        <label>
          <span>状态</span>
          <select name="status" defaultValue={status}>
            <option value="ALL">全部状态</option>
            <option value="UNUSED">未使用</option>
            <option value="REDEEMED">已兑换</option>
            <option value="EXPIRED">已过期</option>
            <option value="DISABLED">已作废</option>
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
        <div className="usage-filter-actions">
          <button className="primary-button compact" type="submit">筛选</button>
          {batch !== "ALL" ? (
            <Link href={downloadHref({ batchName: batch, status })} className="ghost-button compact">下载批次</Link>
          ) : null}
          <Link href="/admin/redeem-codes" className="ghost-button compact">重置</Link>
        </div>
      </form>

      <section className="usage-dashboard-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>批次概览</h2>
              <p>按批次查看库存、兑换、作废和过期情况。</p>
            </div>
            <span className="balance-pill">{formatNumber(batchStats.length)} 个批次</span>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>批次</th>
                  <th>总数</th>
                  <th>未使用</th>
                  <th>已兑换</th>
                  <th>作废</th>
                  <th>过期</th>
                  <th>面额合计</th>
                  <th>下载</th>
                </tr>
              </thead>
              <tbody>
                {batchStats.length === 0 ? (
                  <tr><td colSpan={8} className="usage-empty-cell">暂无批次</td></tr>
                ) : batchStats.map((item) => (
                  <tr key={item.batchName}>
                    <td>
                      <Link className="inline-green" href={`/admin/redeem-codes?batch=${encodeURIComponent(item.batchName)}`}>
                        {item.batchName}
                      </Link>
                    </td>
                    <td>{formatNumber(item.total)}</td>
                    <td>{formatNumber(item.unused)}</td>
                    <td>{formatNumber(item.redeemed)}</td>
                    <td>{formatNumber(item.disabled)}</td>
                    <td>{formatNumber(item.expired)}</td>
                    <td>{formatNumber(item.faceValue)}</td>
                    <td>
                      <Link className="icon-action" href={downloadHref({ batchName: item.batchName, status: "UNUSED" })}>
                        下载未使用
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>生成兑换码</h2>
              <p>创建可发放给用户的积分兑换码。</p>
            </div>
          </header>
          <div className="usage-detail-body">
            <form action={generateRedeemCodesAction} className="redeem-inline-form">
              <label>
                <span>批次</span>
                <input name="batchName" type="text" placeholder="客户充值" defaultValue="客户充值" required />
              </label>
              <label>
                <span>面额</span>
                <input name="creditAmount" type="number" min="1" placeholder="100" required />
              </label>
              <label>
                <span>数量</span>
                <input name="quantity" type="number" min="1" max="500" defaultValue="1" required />
              </label>
              <label>
                <span>过期时间</span>
                <input name="expiresAt" type="date" />
              </label>
              <button type="submit" className="primary-button compact">生成</button>
            </form>
          </div>
        </article>
      </section>

      <section className="usage-records">
        <header>
          <div>
            <h2>兑换码明细</h2>
            <p>最多展示当前筛选条件下最近 500 条兑换码。</p>
          </div>
          <div className="toolbar-actions">
            <Link href={downloadHref({ batchName: batch !== "ALL" ? batch : undefined, status })} className="ghost-button compact">下载当前结果</Link>
            <Link href="/admin/redeem-codes" className="ghost-button compact">刷新</Link>
          </div>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table redeem-table">
            <thead>
              <tr>
                <th>兑换码</th>
                <th>批次</th>
                <th>面额</th>
                <th>状态</th>
                <th>兑换用户</th>
                <th>创建人</th>
                <th>创建时间</th>
                <th>兑换时间</th>
                <th>过期时间</th>
                <th>流水</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr><td colSpan={11} className="usage-empty-cell">暂无兑换码</td></tr>
              ) : codes.map((code) => (
                <tr key={code.id}>
                  <td><code className="redeem-code-text">{code.code}</code></td>
                  <td>{code.batchName}</td>
                  <td><strong>{formatNumber(code.creditAmount)}</strong></td>
                  <td><span className={`role-pill ${statusTone(code)}`}>{displayStatus(code)}</span></td>
                  <td>
                    {code.redeemedBy ? (
                      <Link className="usage-user-link" href={`/admin/users/${code.redeemedBy.id}`}>
                        <strong>{code.redeemedBy.email}</strong>
                        <small>{code.redeemedBy.displayName ?? "未设置"}</small>
                      </Link>
                    ) : "—"}
                  </td>
                  <td>{code.createdBy?.displayName ?? code.createdBy?.email ?? "—"}</td>
                  <td>{formatDateTime(code.createdAt)}</td>
                  <td>{formatDateTime(code.redeemedAt)}</td>
                  <td>{code.expiresAt ? formatDateTime(code.expiresAt) : "永不过期"}</td>
                  <td>{formatNumber(code.transactions.length)}</td>
                  <td>
                    {code.status === "UNUSED" && !isExpired(code) ? (
                      <form action={disableRedeemCodeAction}>
                        <input type="hidden" name="codeId" value={code.id} />
                        <button type="submit" className="icon-action">作废</button>
                      </form>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
