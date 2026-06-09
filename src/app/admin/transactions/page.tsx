import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatTransactionType, getAdminRangeStart } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type TransactionsPageProps = {
  searchParams?: Promise<{
    range?: string;
    type?: string;
    search?: string;
  }>;
};

const validRanges = ["today", "24h", "7d", "30d", "all"] as const;
const validTypes = [
  "ALL",
  "SIGNUP_BONUS",
  "ADMIN_ADJUSTMENT",
  "REDEEM_CODE",
  "GENERATION_DEBIT",
  "GENERATION_REFUND",
] as const;

type TransactionTypeFilter = Exclude<typeof validTypes[number], "ALL">;

function rangeLabel(range: string) {
  return (
    {
      today: "今天",
      "24h": "近 24 小时",
      "7d": "近 7 天",
      "30d": "近 30 天",
      all: "全部时间",
    }[range] ?? "近 24 小时"
  );
}

export default async function AdminTransactionsPage({ searchParams }: TransactionsPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const range = validRanges.includes(params.range as typeof validRanges[number]) ? params.range! : "30d";
  const type = validTypes.includes(params.type as typeof validTypes[number]) ? params.type! : "ALL";
  const startDate = getAdminRangeStart(range);
  const search = params.search?.trim();

  const where: Prisma.CreditTransactionWhereInput = {
    createdAt: startDate ? { gte: startDate } : undefined,
    type: type !== "ALL" ? type as TransactionTypeFilter : undefined,
    user: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { displayName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : undefined,
  };

  const transactions = await prisma.creditTransaction.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      },
      relatedTask: {
        select: {
          id: true,
          status: true,
          size: true,
          quality: true,
        },
      },
      relatedCode: {
        select: {
          id: true,
          code: true,
          batchName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const debitTotal = transactions
    .filter((transaction) => transaction.amount < 0)
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const creditTotal = transactions
    .filter((transaction) => transaction.amount > 0)
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const generationDebit = transactions
    .filter((transaction) => transaction.type === "GENERATION_DEBIT")
    .reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const refundTotal = transactions
    .filter((transaction) => transaction.type === "GENERATION_REFUND")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const cards = [
    { label: "流水数量", value: formatNumber(transactions.length), note: rangeLabel(range) },
    { label: "积分收入", value: formatNumber(creditTotal), note: "正向积分变动" },
    { label: "积分消耗", value: formatNumber(debitTotal), note: "负向积分变动" },
    { label: "生成扣费", value: formatNumber(generationDebit), note: "图片生成消耗" },
    { label: "失败退款", value: formatNumber(refundTotal), note: "生成失败返还" },
    { label: "净变动", value: formatNumber(creditTotal - debitTotal), note: "收入减消耗" },
  ];

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>积分流水</h1>
          <p>查看注册送积分、管理员调整、兑换码充值、生成扣费和失败退款。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/usage" className="ghost-button compact">生成记录</Link>
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <section className="usage-summary-grid">
        {cards.map((card) => (
          <article className="usage-summary-card" key={card.label}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <form className="usage-filters transactions-filters">
        <label>
          <span>时间范围</span>
          <select name="range" defaultValue={range}>
            <option value="today">今天</option>
            <option value="24h">近 24 小时</option>
            <option value="7d">近 7 天</option>
            <option value="30d">近 30 天</option>
            <option value="all">全部时间</option>
          </select>
        </label>
        <label>
          <span>用户</span>
          <input name="search" type="search" placeholder="邮箱 / 昵称" defaultValue={params.search || ""} />
        </label>
        <label>
          <span>类型</span>
          <select name="type" defaultValue={type}>
            <option value="ALL">全部类型</option>
            <option value="SIGNUP_BONUS">注册送积分</option>
            <option value="ADMIN_ADJUSTMENT">管理员调整</option>
            <option value="REDEEM_CODE">兑换码充值</option>
            <option value="GENERATION_DEBIT">生成扣费</option>
            <option value="GENERATION_REFUND">失败退款</option>
          </select>
        </label>
        <div className="usage-filter-actions">
          <button className="primary-button compact" type="submit">筛选</button>
          <Link href="/admin/transactions" className="ghost-button compact">重置</Link>
        </div>
      </form>

      <section className="usage-records">
        <header>
          <div>
            <h2>流水明细</h2>
            <p>最多展示当前筛选条件下最近 500 条积分流水。</p>
          </div>
          <Link className="ghost-button compact" href="/admin/transactions">刷新</Link>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table transactions-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>类型</th>
                <th>变动积分</th>
                <th>变动后余额</th>
                <th>关联任务</th>
                <th>关联兑换码</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={8} className="usage-empty-cell">暂无积分流水</td></tr>
              ) : transactions.map((transaction) => (
                <tr key={transaction.id}>
                  <td>{formatDateTime(transaction.createdAt)}</td>
                  <td>
                    <Link className="usage-user-link" href={`/admin/usage?userId=${transaction.userId}`}>
                      <strong>{transaction.user.email}</strong>
                      <small>{transaction.user.displayName ?? "未设置"}</small>
                    </Link>
                  </td>
                  <td>{formatTransactionType(transaction.type)}</td>
                  <td className={transaction.amount >= 0 ? "transaction-positive" : "transaction-negative"}>
                    {transaction.amount > 0 ? "+" : ""}{formatNumber(transaction.amount)}
                  </td>
                  <td>{formatNumber(transaction.balanceAfter)}</td>
                  <td>
                    {transaction.relatedTask ? (
                      <Link className="inline-green" href={`/admin/usage/${transaction.relatedTask.id}`}>
                        {transaction.relatedTask.id.slice(-8)} · {transaction.relatedTask.size}
                      </Link>
                    ) : "—"}
                  </td>
                  <td>{transaction.relatedCode ? `${transaction.relatedCode.batchName} · ${transaction.relatedCode.code}` : "—"}</td>
                  <td className="usage-prompt-cell" title={transaction.note}>{transaction.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
