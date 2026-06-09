import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type AuditLogsPageProps = {
  searchParams?: Promise<{
    action?: string;
    targetType?: string;
    targetId?: string;
    admin?: string;
  }>;
};

function truncate(value: string, maxLength = 88) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed || "—";
  return `${trimmed.slice(0, maxLength)}...`;
}

function actionLabel(action: string) {
  return (
    {
      ADJUST_CREDITS: "调整积分",
      TOGGLE_USER_STATUS: "切换用户状态",
      GENERATE_CODES: "生成兑换码",
      DISABLE_CODE: "作废兑换码",
      UPDATE_SETTINGS: "更新平台设置",
      UPDATE_SECURITY_SETTINGS: "更新安全设置",
      UPDATE_RISK_CONTROL_SETTINGS: "更新风控设置",
    }[action] ?? action
  );
}

export default async function AdminAuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const action = params.action || "ALL";
  const targetType = params.targetType || "ALL";
  const targetId = params.targetId?.trim();
  const adminSearch = params.admin?.trim();

  const where: Prisma.AdminAuditLogWhereInput = {
    action: action !== "ALL" ? action : undefined,
    targetType: targetType !== "ALL" ? targetType : undefined,
    targetId: targetId ? { contains: targetId } : undefined,
    adminUser: adminSearch
      ? {
          OR: [
            { email: { contains: adminSearch, mode: "insensitive" } },
            { displayName: { contains: adminSearch, mode: "insensitive" } },
          ],
        }
      : undefined,
  };

  const logs = await prisma.adminAuditLog.findMany({
    where,
    include: {
      adminUser: {
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const actions = await prisma.adminAuditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  const targetTypes = await prisma.adminAuditLog.findMany({
    distinct: ["targetType"],
    select: { targetType: true },
    orderBy: { targetType: "asc" },
  });
  const userTargetCount = logs.filter((log) => log.targetType === "user").length;
  const settingsTargetCount = logs.filter((log) => log.targetType === "settings").length;

  const cards = [
    { label: "日志数量", value: formatNumber(logs.length), note: "当前筛选结果" },
    { label: "用户操作", value: formatNumber(userTargetCount), note: "targetType=user" },
    { label: "设置操作", value: formatNumber(settingsTargetCount), note: "targetType=settings" },
    { label: "兑换码操作", value: formatNumber(logs.filter((log) => log.targetType.includes("redeem")).length), note: "兑换码相关" },
    { label: "管理员数", value: formatNumber(new Set(logs.map((log) => log.adminUserId)).size), note: "当前结果内" },
    { label: "最近时间", value: logs[0] ? formatDateTime(logs[0].createdAt) : "—", note: "最新操作" },
  ];

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>操作日志</h1>
          <p>追踪管理员对用户、兑换码、安全、风控和平台设置做过的操作。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/users" className="ghost-button compact">用户管理</Link>
          <Link href="/admin" className="ghost-button compact">后台总览</Link>
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

      <form className="usage-filters audit-filters">
        <label>
          <span>动作</span>
          <select name="action" defaultValue={action}>
            <option value="ALL">全部动作</option>
            {actions.map((item) => (
              <option value={item.action} key={item.action}>{actionLabel(item.action)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>目标类型</span>
          <select name="targetType" defaultValue={targetType}>
            <option value="ALL">全部目标</option>
            {targetTypes.map((item) => (
              <option value={item.targetType} key={item.targetType}>{item.targetType}</option>
            ))}
          </select>
        </label>
        <label>
          <span>目标 ID</span>
          <input name="targetId" type="search" placeholder="完整或部分 ID" defaultValue={params.targetId || ""} />
        </label>
        <label>
          <span>管理员</span>
          <input name="admin" type="search" placeholder="邮箱 / 昵称" defaultValue={params.admin || ""} />
        </label>
        <div className="usage-filter-actions">
          <button className="primary-button compact" type="submit">筛选</button>
          <Link href="/admin/audit-logs" className="ghost-button compact">重置</Link>
        </div>
      </form>

      <section className="usage-records">
        <header>
          <div>
            <h2>日志明细</h2>
            <p>最多展示当前筛选条件下最近 500 条管理员操作。</p>
          </div>
          <Link href="/admin/audit-logs" className="ghost-button compact">刷新</Link>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table audit-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>管理员</th>
                <th>动作</th>
                <th>目标类型</th>
                <th>目标 ID</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={6} className="usage-empty-cell">暂无操作日志</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.createdAt)}</td>
                  <td>
                    <span className="usage-user-link">
                      <strong>{log.adminUser.displayName ?? log.adminUser.email}</strong>
                      <small>{log.adminUser.email}</small>
                    </span>
                  </td>
                  <td>{actionLabel(log.action)}</td>
                  <td>{log.targetType}</td>
                  <td className="mono-cell">
                    {log.targetType === "user" ? (
                      <Link className="inline-green" href={`/admin/users/${log.targetId}`}>
                        {log.targetId}
                      </Link>
                    ) : log.targetId}
                  </td>
                  <td className="usage-prompt-cell" title={log.payload}>{truncate(log.payload)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
