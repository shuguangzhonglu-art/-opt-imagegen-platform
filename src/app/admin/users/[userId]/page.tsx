import Link from "next/link";
import { notFound } from "next/navigation";

import { grantTemporaryCreditsAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAvailableCreditBalance } from "@/lib/services/wallet";
import {
  formatDateTime,
  formatNumber,
  formatRole,
  formatTaskStatus,
  formatTransactionType,
  formatUserStatus,
} from "@/lib/utils/format";

export const dynamic = "force-dynamic";

type AdminUserDetailPageProps = {
  params: Promise<{
    userId: string;
  }>;
};

type UserDetail = NonNullable<Awaited<ReturnType<typeof getUserDetail>>>;
type UserTask = UserDetail["tasks"][number];

function getTaskDurationMs(task: Pick<UserTask, "requestedAt" | "startedAt" | "finishedAt">) {
  if (!task.finishedAt) return null;
  const start = task.startedAt ?? task.requestedAt;
  return Math.max(0, task.finishedAt.getTime() - start.getTime());
}

function formatDuration(ms: number | null) {
  if (ms === null) return "生成中";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`;
}

function rate(part: number, total: number) {
  if (total === 0) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function statusClass(status: string) {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "active";
  return "muted";
}

async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallet: true,
      tasks: {
        orderBy: { requestedAt: "desc" },
        take: 12,
        include: {
          images: {
            select: { id: true },
          },
        },
      },
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 12,
        include: {
          relatedTask: {
            select: {
              id: true,
              size: true,
            },
          },
        },
      },
      creditGrants: {
        orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
        take: 12,
        include: {
          createdBy: {
            select: {
              email: true,
              displayName: true,
            },
          },
        },
      },
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      browserLocks: {
        orderBy: { updatedAt: "desc" },
        take: 5,
      },
      _count: {
        select: {
          tasks: true,
          images: true,
          transactions: true,
          sessions: true,
          browserLocks: true,
        },
      },
    },
  });

  if (!user) return null;

  const taskStats = await prisma.generationTask.groupBy({
    by: ["status"],
    where: { userId },
    _count: { _all: true },
    _sum: { totalCost: true, quantity: true },
  });
  const auditLogs = await prisma.adminAuditLog.findMany({
    where: {
      targetType: "user",
      targetId: userId,
    },
    include: {
      adminUser: {
        select: {
          email: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  return { ...user, taskStats, auditLogs };
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const admin = await requireAdmin();
  const { userId } = await params;
  const user = await getUserDetail(userId);

  if (!user) {
    notFound();
  }

  const taskTotals = user.taskStats.reduce(
    (acc, stat) => {
      const count = stat._count._all;
      acc.tasks += count;
      acc.images += stat._sum.quantity ?? 0;
      acc.credits += stat._sum.totalCost ?? 0;
      if (stat.status === "SUCCESS") acc.success += count;
      if (stat.status === "FAILED") acc.failed += count;
      return acc;
    },
    { tasks: 0, images: 0, credits: 0, success: 0, failed: 0 },
  );
  const durations = user.tasks.map(getTaskDurationMs).filter((duration): duration is number => duration !== null);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
    : null;
  const balance = await getAvailableCreditBalance(user.id);

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  const cards = [
    { label: "当前余额", value: formatNumber(balance.total), note: `永久 ${formatNumber(balance.permanent)} / 短期 ${formatNumber(balance.temporary)}` },
    { label: "任务数", value: formatNumber(taskTotals.tasks), note: "累计生成任务" },
    { label: "图片数", value: formatNumber(user._count.images || taskTotals.images), note: "累计生成图片" },
    { label: "积分消耗", value: formatNumber(taskTotals.credits), note: "任务 totalCost 合计" },
    { label: "成功率", value: rate(taskTotals.success, taskTotals.tasks), note: `${taskTotals.success} 个成功任务` },
    { label: "平均耗时", value: formatDuration(avgDuration), note: "最近任务平均值" },
  ];

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>用户详情</h1>
          <p>查看账户、钱包、生成统计、最近任务、积分流水和管理员操作记录。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href={`/admin/usage?userId=${user.id}`} className="ghost-button compact">生成记录</Link>
          <Link href={`/admin/transactions?search=${encodeURIComponent(user.email)}`} className="ghost-button compact">积分流水</Link>
          <Link href="/admin/users" className="ghost-button compact">返回用户</Link>
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

      <section className="usage-detail-grid">
        <article className="usage-panel usage-detail-main">
          <header>
            <div>
              <h2>账户信息</h2>
              <p>基础身份、状态和安全绑定。</p>
            </div>
            <span className={user.status === "ACTIVE" ? "status-dot ok" : "status-dot muted"}>
              {formatUserStatus(user.status)}
            </span>
          </header>
          <div className="usage-detail-body">
            <dl className="usage-detail-list user-profile-list">
              <div>
                <dt>邮箱</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>昵称</dt>
                <dd>{user.displayName ?? "未设置"}</dd>
              </div>
              <div>
                <dt>用户 ID</dt>
                <dd className="mono-cell">{user.id}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd>{formatRole(user.role)}</dd>
              </div>
              <div>
                <dt>邮箱验证</dt>
                <dd>{formatDateTime(user.emailVerifiedAt)}</dd>
              </div>
              <div>
                <dt>注册时间</dt>
                <dd>{formatDateTime(user.createdAt)}</dd>
              </div>
              <div>
                <dt>最后登录</dt>
                <dd>{formatDateTime(user.lastLoginAt)}</dd>
              </div>
              <div>
                <dt>会话 / 浏览器锁</dt>
                <dd>{formatNumber(user._count.sessions)} / {formatNumber(user._count.browserLocks)}</dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>快速操作</h2>
              <p>常用运营入口。</p>
            </div>
          </header>
          <div className="usage-detail-body quick-action-grid">
            <Link href={`/admin/usage?userId=${user.id}`} className="ghost-button compact">查看生成记录</Link>
            <Link href={`/admin/transactions?search=${encodeURIComponent(user.email)}`} className="ghost-button compact">查看积分流水</Link>
            <Link href={`/admin/audit-logs?targetId=${user.id}`} className="ghost-button compact">查看审计日志</Link>
            <Link href="/admin/redeem-codes" className="ghost-button compact">兑换码管理</Link>
          </div>
        </article>
      </section>

      <section className="usage-detail-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>发放短期积分</h2>
              <p>活动积分会优先于永久积分消耗。</p>
            </div>
          </header>
          <form action={grantTemporaryCreditsAction} className="usage-detail-body quick-action-grid">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="redirectTo" value={`/admin/users/${user.id}`} />
            <label>
              <span>积分</span>
              <input name="amount" type="number" min="1" placeholder="100" required />
            </label>
            <label>
              <span>过期时间</span>
              <input name="expiresAt" type="datetime-local" required />
            </label>
            <label>
              <span>备注</span>
              <input name="note" type="text" defaultValue="活动短期积分" />
            </label>
            <button type="submit" className="primary-button compact">发放</button>
          </form>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>短期积分包</h2>
              <p>最近 12 个积分包，过期后不再可用。</p>
            </div>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>剩余</th>
                  <th>总额</th>
                  <th>过期时间</th>
                  <th>来源</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {user.creditGrants.length === 0 ? (
                  <tr><td colSpan={5} className="usage-empty-cell">暂无短期积分</td></tr>
                ) : user.creditGrants.map((grant) => (
                  <tr key={grant.id}>
                    <td>{formatNumber(grant.remaining)}</td>
                    <td>{formatNumber(grant.amount)}</td>
                    <td>{formatDateTime(grant.expiresAt)}</td>
                    <td>{grant.createdBy?.displayName ?? grant.createdBy?.email ?? grant.source}</td>
                    <td className="usage-prompt-cell" title={grant.note}>{grant.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="usage-detail-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>最近任务</h2>
              <p>该用户最近 12 条图片生成任务。</p>
            </div>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>请求时间</th>
                  <th>状态</th>
                  <th>尺寸</th>
                  <th>质量</th>
                  <th>图片</th>
                  <th>积分</th>
                  <th>耗时</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {user.tasks.length === 0 ? (
                  <tr><td colSpan={8} className="usage-empty-cell">暂无生成任务</td></tr>
                ) : user.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{formatDateTime(task.requestedAt)}</td>
                    <td><span className={`status-dot ${statusClass(task.status)}`}>{formatTaskStatus(task.status)}</span></td>
                    <td className="mono-cell">{task.size}</td>
                    <td>{task.quality}</td>
                    <td>{formatNumber(task.images.length || task.quantity)}</td>
                    <td>{formatNumber(task.totalCost)}</td>
                    <td>{formatDuration(getTaskDurationMs(task))}</td>
                    <td><Link className="icon-action" href={`/admin/usage/${task.id}`}>查看</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>最近积分流水</h2>
              <p>充值、扣费、退款和管理员调整。</p>
            </div>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>变动</th>
                  <th>余额</th>
                  <th>关联</th>
                </tr>
              </thead>
              <tbody>
                {user.transactions.length === 0 ? (
                  <tr><td colSpan={5} className="usage-empty-cell">暂无积分流水</td></tr>
                ) : user.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatDateTime(transaction.createdAt)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="usage-records">
        <header>
          <div>
            <h2>管理员操作日志</h2>
            <p>针对该用户的最近管理动作。</p>
          </div>
          <Link href={`/admin/audit-logs?targetId=${user.id}`} className="ghost-button compact">查看全部</Link>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table transactions-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>管理员</th>
                <th>动作</th>
                <th>目标</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {user.auditLogs.length === 0 ? (
                <tr><td colSpan={5} className="usage-empty-cell">暂无管理员操作日志</td></tr>
              ) : user.auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.createdAt)}</td>
                  <td>{log.adminUser.displayName ?? log.adminUser.email}</td>
                  <td>{log.action}</td>
                  <td>{log.targetType} · {log.targetId.slice(-8)}</td>
                  <td className="usage-prompt-cell" title={log.payload}>{log.payload}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
