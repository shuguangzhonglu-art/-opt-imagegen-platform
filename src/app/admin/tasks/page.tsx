import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatTaskStatus, getAdminRangeStart } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type AdminTasksPageProps = {
  searchParams?: Promise<{
    range?: string;
    status?: string;
    search?: string;
  }>;
};

const validRanges = ["today", "24h", "7d", "30d"] as const;
const validStatuses = ["ALL", "PENDING", "RUNNING", "SUCCESS", "FAILED"] as const;
type TaskStatusFilter = Exclude<typeof validStatuses[number], "ALL">;

type TaskRow = Awaited<ReturnType<typeof getTasks>>[number];

function rangeLabel(range: string) {
  return (
    {
      today: "今天",
      "24h": "近 24 小时",
      "7d": "近 7 天",
      "30d": "近 30 天",
    }[range] ?? "近 24 小时"
  );
}

function getTaskDurationMs(task: Pick<TaskRow, "requestedAt" | "startedAt" | "finishedAt">) {
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

function statusClass(status: string) {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "active";
  return "muted";
}

function truncate(value: string | null | undefined, maxLength = 48) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "—";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

async function getTasks(where: Prisma.GenerationTaskWhereInput) {
  return prisma.generationTask.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      },
      images: {
        select: { id: true },
      },
    },
    orderBy: { requestedAt: "desc" },
    take: 500,
  });
}

export default async function AdminTasksPage({ searchParams }: AdminTasksPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const range = validRanges.includes(params.range as typeof validRanges[number]) ? params.range! : "24h";
  const status = validStatuses.includes(params.status as typeof validStatuses[number]) ? params.status! : "ALL";
  const search = params.search?.trim();
  const startDate = getAdminRangeStart(range)!;

  const where: Prisma.GenerationTaskWhereInput = {
    requestedAt: { gte: startDate },
    status: status !== "ALL" ? status as TaskStatusFilter : undefined,
    user: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { displayName: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
  };
  const tasks = await getTasks(where);
  const totalTasks = tasks.length;
  const pendingTasks = tasks.filter((task) => task.status === "PENDING").length;
  const runningTasks = tasks.filter((task) => task.status === "RUNNING").length;
  const successTasks = tasks.filter((task) => task.status === "SUCCESS").length;
  const failedTasks = tasks.filter((task) => task.status === "FAILED").length;
  const durations = tasks.map(getTaskDurationMs).filter((duration): duration is number => duration !== null);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
    : null;
  const failedReasons = [...tasks.filter((task) => task.status === "FAILED").reduce((map, task) => {
    const key = truncate(task.errorMessage || task.rawError, 72);
    const current = map.get(key) ?? { reason: key, count: 0 };
    current.count += 1;
    map.set(key, current);
    return map;
  }, new Map<string, { reason: string; count: number }>()).values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const cards = [
    { label: "任务总数", value: formatNumber(totalTasks), note: rangeLabel(range) },
    { label: "排队中", value: formatNumber(pendingTasks), note: "等待 worker 消费" },
    { label: "生成中", value: formatNumber(runningTasks), note: "正在执行" },
    { label: "已完成", value: formatNumber(successTasks), note: "成功任务" },
    { label: "失败", value: formatNumber(failedTasks), note: "失败任务" },
    { label: "平均耗时", value: formatDuration(avgDuration), note: "完成任务平均值" },
  ];

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>任务监控</h1>
          <p>查看生成任务的排队、运行、成功、失败和耗时状态。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/usage" className="ghost-button compact">生成记录</Link>
          <Link href="/admin/images" className="ghost-button compact">图片资产</Link>
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
          </select>
        </label>
        <label>
          <span>用户</span>
          <input name="search" type="search" placeholder="邮箱 / 昵称" defaultValue={params.search || ""} />
        </label>
        <label>
          <span>状态</span>
          <select name="status" defaultValue={status}>
            <option value="ALL">全部状态</option>
            <option value="PENDING">排队中</option>
            <option value="RUNNING">生成中</option>
            <option value="SUCCESS">已完成</option>
            <option value="FAILED">失败</option>
          </select>
        </label>
        <div className="usage-filter-actions">
          <button className="primary-button compact" type="submit">筛选</button>
          <Link href="/admin/tasks" className="ghost-button compact">重置</Link>
        </div>
      </form>

      <section className="usage-dashboard-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>失败原因</h2>
              <p>聚合当前筛选条件下的失败任务错误摘要。</p>
            </div>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>错误摘要</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {failedReasons.length === 0 ? (
                  <tr><td colSpan={2} className="usage-empty-cell">暂无失败任务</td></tr>
                ) : failedReasons.map((item) => (
                  <tr key={item.reason}>
                    <td className="usage-error-cell" title={item.reason}>{item.reason}</td>
                    <td>{formatNumber(item.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>队列提示</h2>
              <p>排队和运行数量用于判断 worker 是否正常消费。</p>
            </div>
            <Link href="/admin/tasks?status=PENDING" className="ghost-button compact">查看排队</Link>
          </header>
          <div className="usage-detail-body">
            <dl className="usage-detail-list">
              <div><dt>排队任务</dt><dd>{formatNumber(pendingTasks)}</dd></div>
              <div><dt>运行任务</dt><dd>{formatNumber(runningTasks)}</dd></div>
              <div><dt>失败任务</dt><dd>{formatNumber(failedTasks)}</dd></div>
              <div><dt>最近任务</dt><dd>{tasks[0] ? formatDateTime(tasks[0].requestedAt) : "—"}</dd></div>
            </dl>
          </div>
        </article>
      </section>

      <section className="usage-records">
        <header>
          <div>
            <h2>任务明细</h2>
            <p>最多展示当前筛选条件下最近 500 条任务。</p>
          </div>
          <Link href="/admin/tasks" className="ghost-button compact">刷新</Link>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table usage-record-table">
            <thead>
              <tr>
                <th>请求时间</th>
                <th>用户</th>
                <th>状态</th>
                <th>尺寸</th>
                <th>质量</th>
                <th>图片</th>
                <th>积分</th>
                <th>耗时</th>
                <th>重试</th>
                <th>错误</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr><td colSpan={11} className="usage-empty-cell">暂无任务</td></tr>
              ) : tasks.map((task) => (
                <tr key={task.id}>
                  <td>{formatDateTime(task.requestedAt)}</td>
                  <td>
                    <Link className="usage-user-link" href={`/admin/users/${task.userId}`}>
                      <strong>{task.user.email}</strong>
                      <small>{task.user.displayName ?? "未设置"}</small>
                    </Link>
                  </td>
                  <td><span className={`status-dot ${statusClass(task.status)}`}>{formatTaskStatus(task.status)}</span></td>
                  <td className="mono-cell">{task.size}</td>
                  <td>{task.quality}</td>
                  <td>{formatNumber(task.images.length || task.quantity)}</td>
                  <td>{formatNumber(task.totalCost)}</td>
                  <td>{formatDuration(getTaskDurationMs(task))}</td>
                  <td>{formatNumber(task.retryCount)}</td>
                  <td className="usage-error-cell" title={task.rawError || task.errorMessage || ""}>{truncate(task.errorMessage || task.rawError, 36)}</td>
                  <td><Link href={`/admin/usage/${task.id}`} className="icon-action">查看</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
