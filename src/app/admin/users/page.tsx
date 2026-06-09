import Link from "next/link";

import { Notice } from "@/components/notice";
import { adjustUserCreditsAction, grantTemporaryCreditsAction, toggleUserStatusAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCreditGrantSummaryByUserIds } from "@/lib/services/wallet";
import { formatDateTime, formatNumber, formatRole, formatUserStatus } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type UsersPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
  }>;
};

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      wallet: true,
      _count: {
        select: {
          tasks: true,
          images: true,
          transactions: true,
        },
      },
      tasks: {
        orderBy: { requestedAt: "desc" },
        take: 1,
        select: { requestedAt: true },
      },
    },
  });
  const grantSummary = await getCreditGrantSummaryByUserIds(users.map((user) => user.id));
  const totalBalance = users.reduce((sum, user) => {
    const temporary = grantSummary.get(user.id)?.temporary ?? 0;
    return sum + (user.wallet?.balance ?? 0) + temporary;
  }, 0);
  const userStats = await prisma.generationTask.groupBy({
    by: ["userId", "status"],
    _count: { _all: true },
    _sum: { totalCost: true, quantity: true },
  });
  const statsByUser = new Map<string, {
    tasks: number;
    images: number;
    credits: number;
    success: number;
    failed: number;
  }>();

  for (const stat of userStats) {
    const current = statsByUser.get(stat.userId) ?? {
      tasks: 0,
      images: 0,
      credits: 0,
      success: 0,
      failed: 0,
    };
    const count = stat._count._all;
    current.tasks += count;
    current.images += stat._sum.quantity ?? 0;
    current.credits += stat._sum.totalCost ?? 0;
    if (stat.status === "SUCCESS") current.success += count;
    if (stat.status === "FAILED") current.failed += count;
    statsByUser.set(stat.userId, current);
  }

  function userInitial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  function userName(user: { displayName: string | null; email: string }) {
    return user.displayName?.trim() || "未设置";
  }

  function formatRate(part: number, total: number) {
    if (total === 0) return "—";
    return `${((part / total) * 100).toFixed(1)}%`;
  }

  return (
    <main className="sub-admin-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>用户管理</h1>
          <p>管理用户账户和权限</p>
        </div>
        <div className="sub-admin-account">
          <span className="balance-pill">{totalBalance} 积分</span>
          <span className="admin-avatar">{userInitial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="sub-admin-toolbar users-admin-toolbar">
        <label className="admin-search">
          <span>⌕</span>
          <input type="search" placeholder="邮箱/用户名/备注/API Key 模糊搜索" />
        </label>
        <div className="toolbar-actions">
          <Link href="/admin/redeem-codes" className="ghost-button compact">兑换码</Link>
          <Link href="/admin/campaigns" className="ghost-button compact">活动积分</Link>
          <Link href="/admin/usage" className="ghost-button compact">生成记录</Link>
          <Link href="/admin/tasks" className="ghost-button compact">任务监控</Link>
          <Link href="/admin/images" className="ghost-button compact">图片资产</Link>
          <Link href="/admin/transactions" className="ghost-button compact">积分流水</Link>
          <Link href="/admin/audit-logs" className="ghost-button compact">操作日志</Link>
          <Link href="/admin/security" className="ghost-button compact">安全配置</Link>
          <Link href="/admin/risk-control" className="ghost-button compact">风控中心</Link>
          <Link href="/admin/settings" className="ghost-button compact">设置中心</Link>
        </div>
      </section>

      <section className="sub-table-card users-table-card">
        <table className="sub-admin-table users-admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th>余额</th>
              <th>状态</th>
              <th>任务数</th>
              <th>图片数</th>
              <th>积分消耗</th>
              <th>成功率</th>
              <th>最后生成时间</th>
              <th>最后登录时间</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const stats = statsByUser.get(user.id) ?? {
                tasks: 0,
                images: user._count.images,
                credits: 0,
                success: 0,
                failed: 0,
              };
              const temporaryBalance = grantSummary.get(user.id)?.temporary ?? 0;
              const earliestExpiresAt = grantSummary.get(user.id)?.earliestExpiresAt ?? null;
              const totalUserBalance = (user.wallet?.balance ?? 0) + temporaryBalance;

              return (
                <tr key={user.id}>
                  <td className="admin-user-cell">
                    <span className="user-avatar">{userInitial(userName(user))}</span>
                    <Link className="usage-user-link admin-user-link" href={`/admin/users/${user.id}`}>
                      <strong>{user.email}</strong>
                      <small>查看详情</small>
                    </Link>
                  </td>
                  <td className="mono-cell">{user.id.slice(-6)}</td>
                  <td>{userName(user)}</td>
                  <td>
                    <span className={user.role === "ADMIN" ? "role-pill admin" : "role-pill"}>
                      {formatRole(user.role)}
                    </span>
                  </td>
                  <td>
                    <strong>{formatNumber(totalUserBalance)}</strong>
                    <small className="muted-cell">永久 {formatNumber(user.wallet?.balance ?? 0)} / 短期 {formatNumber(temporaryBalance)}</small>
                    {earliestExpiresAt ? (
                      <small className="muted-cell">最近过期 {formatDateTime(earliestExpiresAt)}</small>
                    ) : null}
                    <Link className="inline-green" href="/admin/redeem-codes">充值</Link>
                  </td>
                  <td>
                    <span className={user.status === "ACTIVE" ? "status-dot ok" : "status-dot muted"}>
                      {formatUserStatus(user.status)}
                    </span>
                  </td>
                  <td>{formatNumber(stats.tasks)}</td>
                  <td>{formatNumber(stats.images)}</td>
                  <td>{formatNumber(stats.credits)}</td>
                  <td>{formatRate(stats.success, stats.tasks)}</td>
                  <td>{formatDateTime(user.tasks[0]?.requestedAt)}</td>
                  <td>{formatDateTime(user.lastLoginAt)}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td className="admin-actions-cell">
                    <Link className="icon-action" href={`/admin/users/${user.id}`}>
                      详情
                    </Link>
                    <Link className="icon-action" href={`/admin/usage?userId=${user.id}`}>
                      生成记录
                    </Link>
                    <Link className="icon-action" href={`/admin/transactions?search=${encodeURIComponent(user.email)}`}>
                      流水
                    </Link>
                    <details className="row-more">
                      <summary className="icon-action">更多</summary>
                      <div className="row-popover">
                        <form action={adjustUserCreditsAction} className="inline-admin-form">
                          <input type="hidden" name="userId" value={user.id} />
                          <input name="amount" type="number" placeholder="+100 / -20" required />
                          <input name="note" type="text" placeholder="备注" defaultValue="管理员调整积分" />
                          <button type="submit" className="primary-button compact">保存</button>
                        </form>
                        <form action={grantTemporaryCreditsAction} className="inline-admin-form">
                          <input type="hidden" name="userId" value={user.id} />
                          <input name="amount" type="number" min="1" placeholder="短期积分" required />
                          <input name="expiresAt" type="datetime-local" required />
                          <input name="note" type="text" placeholder="活动备注" defaultValue="活动短期积分" />
                          <button type="submit" className="primary-button compact">发短期</button>
                        </form>
                        <form action={toggleUserStatusAction}>
                          <input type="hidden" name="userId" value={user.id} />
                          <input
                            type="hidden"
                            name="nextStatus"
                            value={user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
                          />
                          <button type="submit" className="ghost-button compact">
                            {user.status === "ACTIVE" ? "禁用" : "启用"}
                          </button>
                        </form>
                      </div>
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
