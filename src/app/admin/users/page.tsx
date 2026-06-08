import Link from "next/link";

import { Notice } from "@/components/notice";
import { adjustUserCreditsAction, toggleUserStatusAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatRole, formatUserStatus } from "@/lib/utils/format";

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
          transactions: true,
        },
      },
    },
  });
  const totalBalance = users.reduce((sum, user) => sum + (user.wallet?.balance ?? 0), 0);

  function userInitial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  function userName(user: { displayName: string | null; email: string }) {
    return user.displayName?.trim() || "未设置";
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

      <section className="sub-admin-toolbar">
        <label className="admin-search">
          <span>⌕</span>
          <input type="search" placeholder="邮箱/用户名/备注/API Key 模糊搜索" />
        </label>
        <div className="toolbar-actions">
          <Link href="/admin/redeem-codes" className="ghost-button compact">兑换码</Link>
          <Link href="/admin/security" className="ghost-button compact">安全配置</Link>
          <Link href="/admin/risk-control" className="ghost-button compact">风控中心</Link>
          <button className="ghost-button compact" type="button">筛选设置</button>
          <button className="ghost-button compact" type="button">列设置</button>
          <button className="primary-button compact" type="button">创建用户</button>
        </div>
      </section>

      <section className="sub-table-card">
        <table className="sub-admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>ID</th>
              <th>用户名</th>
              <th>角色</th>
              <th>余额</th>
              <th>状态</th>
              <th>最后活跃时间</th>
              <th>最后使用时间</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="admin-user-cell">
                  <span className="user-avatar">{userInitial(userName(user))}</span>
                  <strong>{user.email}</strong>
                </td>
                <td className="mono-cell">{user.id.slice(-6)}</td>
                <td>{userName(user)}</td>
                <td>
                  <span className={user.role === "ADMIN" ? "role-pill admin" : "role-pill"}>
                    {formatRole(user.role)}
                  </span>
                </td>
                <td>
                  <strong>{user.wallet?.balance ?? 0}</strong>
                  <Link className="inline-green" href="/admin/redeem-codes">充值</Link>
                </td>
                <td>
                  <span className={user.status === "ACTIVE" ? "status-dot ok" : "status-dot muted"}>
                    {formatUserStatus(user.status)}
                  </span>
                </td>
                <td>{formatDateTime(user.lastLoginAt)}</td>
                <td>{user._count.tasks > 0 ? `${user._count.tasks} 个任务` : "—"}</td>
                <td>{formatDateTime(user.createdAt)}</td>
                <td className="admin-actions-cell">
                  <details className="row-more">
                    <summary>更多</summary>
                    <div className="row-popover">
                      <form action={adjustUserCreditsAction} className="inline-admin-form">
                        <input type="hidden" name="userId" value={user.id} />
                        <input name="amount" type="number" placeholder="+100 / -20" required />
                        <input name="note" type="text" placeholder="备注" defaultValue="管理员调整积分" />
                        <button type="submit" className="primary-button compact">保存</button>
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
                  <form action={toggleUserStatusAction}>
                    <input type="hidden" name="userId" value={user.id} />
                    <input type="hidden" name="nextStatus" value={user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
                    <button type="submit" className="icon-action">
                      {user.status === "ACTIVE" ? "禁用" : "启用"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
