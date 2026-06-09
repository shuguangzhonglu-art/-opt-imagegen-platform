import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatTaskStatus, getBeijingTodayStart } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type DashboardTask = Awaited<ReturnType<typeof getTodayTasks>>[number];

function getTaskDurationMs(task: Pick<DashboardTask, "requestedAt" | "startedAt" | "finishedAt">) {
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
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function truncate(value: string, maxLength = 42) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed || "—";
  return `${trimmed.slice(0, maxLength)}...`;
}

function statusClass(status: string) {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "active";
  return "muted";
}

async function getTodayTasks(startDate: Date) {
  return prisma.generationTask.findMany({
    where: { requestedAt: { gte: startDate } },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      },
      images: {
        select: {
          id: true,
        },
      },
    },
    orderBy: { requestedAt: "desc" },
    take: 500,
  });
}

function summarizeTasks(tasks: DashboardTask[]) {
  const totalTasks = tasks.length;
  const pendingTasks = tasks.filter((task) => task.status === "PENDING").length;
  const runningTasks = tasks.filter((task) => task.status === "RUNNING").length;
  const successTasks = tasks.filter((task) => task.status === "SUCCESS").length;
  const failedTasks = tasks.filter((task) => task.status === "FAILED").length;
  const imageCount = tasks.reduce((sum, task) => sum + (task.images.length || task.quantity), 0);
  const creditCost = tasks.reduce((sum, task) => sum + task.totalCost, 0);
  const activeUsers = new Set(tasks.map((task) => task.userId)).size;
  const durations = tasks.map(getTaskDurationMs).filter((duration): duration is number => duration !== null);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
    : null;

  return {
    totalTasks,
    pendingTasks,
    runningTasks,
    successTasks,
    failedTasks,
    imageCount,
    creditCost,
    activeUsers,
    avgDuration,
    successRate: rate(successTasks, totalTasks),
    failureRate: rate(failedTasks, totalTasks),
  };
}

function groupByUser(tasks: DashboardTask[]) {
  const map = new Map<string, {
    id: string;
    email: string;
    name: string;
    tasks: number;
    images: number;
    credits: number;
    success: number;
    failed: number;
    lastRequestedAt: Date;
  }>();

  for (const task of tasks) {
    const entry = map.get(task.userId) ?? {
      id: task.userId,
      email: task.user.email,
      name: task.user.displayName ?? "未设置",
      tasks: 0,
      images: 0,
      credits: 0,
      success: 0,
      failed: 0,
      lastRequestedAt: task.requestedAt,
    };

    entry.tasks += 1;
    entry.images += task.images.length || task.quantity;
    entry.credits += task.totalCost;
    if (task.status === "SUCCESS") entry.success += 1;
    if (task.status === "FAILED") entry.failed += 1;
    if (task.requestedAt > entry.lastRequestedAt) entry.lastRequestedAt = task.requestedAt;
    map.set(task.userId, entry);
  }

  return [...map.values()].sort((a, b) => b.credits - a.credits).slice(0, 6);
}

export default async function AdminDashboardPage() {
  const admin = await requireAdmin();
  const tasks = await getTodayTasks(getBeijingTodayStart());
  const summary = summarizeTasks(tasks);
  const userRows = groupByUser(tasks);
  const attentionTasks = tasks
    .filter((task) => task.status === "FAILED" || task.status === "RUNNING" || task.status === "PENDING")
    .slice(0, 8);
  const cards = [
    { label: "今日任务", value: formatNumber(summary.totalTasks), note: "今天提交的生成任务" },
    { label: "今日图片", value: formatNumber(summary.imageCount), note: "生成图片总量" },
    { label: "积分消耗", value: formatNumber(summary.creditCost), note: "今日任务消耗积分" },
    { label: "成功率", value: summary.successRate, note: `${summary.successTasks} 个成功任务` },
    { label: "失败率", value: summary.failureRate, note: `${summary.failedTasks} 个失败任务` },
    { label: "平均耗时", value: formatDuration(summary.avgDuration), note: "已完成任务平均值" },
  ];

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>后台总览</h1>
          <p>查看今天的图片生成任务、图片数、积分消耗、成功率、失败率和耗时。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/usage" className="primary-button compact">生成记录</Link>
          <Link href="/admin/tasks" className="ghost-button compact">任务监控</Link>
          <Link href="/admin/images" className="ghost-button compact">图片资产</Link>
          <Link href="/admin/transactions" className="ghost-button compact">积分流水</Link>
          <Link href="/admin/campaigns" className="ghost-button compact">活动积分</Link>
          <Link href="/admin/invite-codes" className="ghost-button compact">邀请码</Link>
          <Link href="/admin/audit-logs" className="ghost-button compact">操作日志</Link>
          <Link href="/admin/settings" className="ghost-button compact">设置中心</Link>
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

      <section className="admin-ops-strip">
        <article>
          <span>队列待处理</span>
          <strong>{formatNumber(summary.pendingTasks)}</strong>
          <small>等待 worker 接取</small>
        </article>
        <article>
          <span>生成中</span>
          <strong>{formatNumber(summary.runningTasks)}</strong>
          <small>当前运行任务</small>
        </article>
        <article>
          <span>今日活跃用户</span>
          <strong>{formatNumber(summary.activeUsers)}</strong>
          <small>提交过任务的用户</small>
        </article>
        <article>
          <span>需要关注</span>
          <strong>{formatNumber(summary.failedTasks + summary.pendingTasks)}</strong>
          <small>失败 + 排队任务</small>
        </article>
      </section>

      <section className="usage-dashboard-grid">
        <article className="usage-panel user-rank-panel">
          <header>
            <div>
              <h2>今日用户消耗排行</h2>
              <p>按积分消耗排序，快速发现高活跃用户。</p>
            </div>
            <Link href="/admin/usage?range=today" className="ghost-button compact">查看全部</Link>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>任务数</th>
                  <th>图片数</th>
                  <th>积分</th>
                  <th>成功率</th>
                  <th>最后请求</th>
                </tr>
              </thead>
              <tbody>
                {userRows.length === 0 ? (
                  <tr><td colSpan={6} className="usage-empty-cell">今天暂无用户生成记录</td></tr>
                ) : userRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="usage-user-link" href={`/admin/usage?range=today&userId=${row.id}`}>
                        <strong>{row.email}</strong>
                        <small>{row.name}</small>
                      </Link>
                    </td>
                    <td>{formatNumber(row.tasks)}</td>
                    <td>{formatNumber(row.images)}</td>
                    <td>{formatNumber(row.credits)}</td>
                    <td>{rate(row.success, row.tasks)}</td>
                    <td>{formatDateTime(row.lastRequestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>任务队列与异常</h2>
              <p>优先展示排队、运行和失败任务。</p>
            </div>
            <Link href="/admin/tasks" className="ghost-button compact">任务监控</Link>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>状态</th>
                  <th>尺寸</th>
                  <th>积分</th>
                  <th>Prompt</th>
                </tr>
              </thead>
              <tbody>
                {(attentionTasks.length ? attentionTasks : tasks.slice(0, 8)).length === 0 ? (
                  <tr><td colSpan={6} className="usage-empty-cell">今天暂无生成任务</td></tr>
                ) : (attentionTasks.length ? attentionTasks : tasks.slice(0, 8)).map((task) => (
                  <tr key={task.id}>
                    <td>{formatDateTime(task.requestedAt)}</td>
                    <td>
                      <Link className="usage-user-link" href={`/admin/usage?range=today&userId=${task.userId}`}>
                        <strong>{task.user.email}</strong>
                        <small>{task.user.displayName ?? "未设置"}</small>
                      </Link>
                    </td>
                    <td><span className={`status-dot ${statusClass(task.status)}`}>{formatTaskStatus(task.status)}</span></td>
                    <td className="mono-cell">{task.size}</td>
                    <td>{formatNumber(task.totalCost)}</td>
                    <td className="usage-prompt-cell" title={task.prompt}>{truncate(task.prompt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </main>
  );
}
