import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatTaskStatus, getAdminRangeStart } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type UsagePageProps = {
  searchParams?: Promise<{
    range?: string;
    userId?: string;
    search?: string;
    status?: string;
    size?: string;
    quality?: string;
  }>;
};

type UsageTask = Awaited<ReturnType<typeof getUsageTasks>>[number];

const validStatuses = ["ALL", "PENDING", "RUNNING", "SUCCESS", "FAILED"] as const;
const validRanges = ["today", "24h", "7d", "30d"] as const;

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

function getTaskDurationMs(task: Pick<UsageTask, "requestedAt" | "startedAt" | "finishedAt">) {
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

function statusClass(status: string) {
  if (status === "SUCCESS") return "ok";
  if (status === "FAILED") return "danger";
  if (status === "RUNNING") return "active";
  return "muted";
}

function truncate(value: string, maxLength = 44) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed || "—";
  return `${trimmed.slice(0, maxLength)}...`;
}

async function getUsageTasks(input: {
  startDate: Date;
  userId?: string;
  search?: string;
  status?: string;
  size?: string;
  quality?: string;
}) {
  return prisma.generationTask.findMany({
    where: {
      requestedAt: { gte: input.startDate },
      userId: input.userId || undefined,
      status: input.status && input.status !== "ALL" ? input.status as "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" : undefined,
      size: input.size && input.size !== "ALL" ? input.size : undefined,
      quality: input.quality && input.quality !== "ALL" ? input.quality : undefined,
      user: input.search
        ? {
            OR: [
              { email: { contains: input.search, mode: "insensitive" } },
              { displayName: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : undefined,
    },
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
          filePath: true,
        },
      },
    },
    orderBy: { requestedAt: "desc" },
    take: 500,
  });
}

function summarizeTasks(tasks: UsageTask[]) {
  const totalTasks = tasks.length;
  const successTasks = tasks.filter((task) => task.status === "SUCCESS").length;
  const failedTasks = tasks.filter((task) => task.status === "FAILED").length;
  const imageCount = tasks.reduce((sum, task) => sum + (task.images.length || task.quantity), 0);
  const creditCost = tasks.reduce((sum, task) => sum + task.totalCost, 0);
  const completedDurations = tasks
    .map(getTaskDurationMs)
    .filter((duration): duration is number => duration !== null);
  const avgDuration = completedDurations.length
    ? Math.round(completedDurations.reduce((sum, duration) => sum + duration, 0) / completedDurations.length)
    : null;

  return {
    totalTasks,
    successTasks,
    failedTasks,
    imageCount,
    creditCost,
    avgDuration,
    successRate: rate(successTasks, totalTasks),
    failureRate: rate(failedTasks, totalTasks),
  };
}

function groupByUser(tasks: UsageTask[]) {
  const map = new Map<string, {
    id: string;
    email: string;
    name: string;
    tasks: number;
    images: number;
    credits: number;
    success: number;
    failed: number;
    durations: number[];
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
      durations: [],
      lastRequestedAt: task.requestedAt,
    };

    entry.tasks += 1;
    entry.images += task.images.length || task.quantity;
    entry.credits += task.totalCost;
    if (task.status === "SUCCESS") entry.success += 1;
    if (task.status === "FAILED") entry.failed += 1;
    const duration = getTaskDurationMs(task);
    if (duration !== null) entry.durations.push(duration);
    if (task.requestedAt > entry.lastRequestedAt) entry.lastRequestedAt = task.requestedAt;
    map.set(task.userId, entry);
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      avgDuration: entry.durations.length
        ? Math.round(entry.durations.reduce((sum, duration) => sum + duration, 0) / entry.durations.length)
        : null,
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 8);
}

function groupByField(tasks: UsageTask[], field: "size" | "quality") {
  const map = new Map<string, {
    label: string;
    tasks: number;
    images: number;
    credits: number;
    success: number;
    failed: number;
    durations: number[];
  }>();

  for (const task of tasks) {
    const key = task[field] || "未设置";
    const entry = map.get(key) ?? {
      label: key,
      tasks: 0,
      images: 0,
      credits: 0,
      success: 0,
      failed: 0,
      durations: [],
    };

    entry.tasks += 1;
    entry.images += task.images.length || task.quantity;
    entry.credits += task.totalCost;
    if (task.status === "SUCCESS") entry.success += 1;
    if (task.status === "FAILED") entry.failed += 1;
    const duration = getTaskDurationMs(task);
    if (duration !== null) entry.durations.push(duration);
    map.set(key, entry);
  }

  return [...map.values()]
    .map((entry) => ({
      ...entry,
      avgDuration: entry.durations.length
        ? Math.round(entry.durations.reduce((sum, duration) => sum + duration, 0) / entry.durations.length)
        : null,
    }))
    .sort((a, b) => b.tasks - a.tasks);
}

export default async function AdminUsagePage({ searchParams }: UsagePageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const range = validRanges.includes(params.range as typeof validRanges[number]) ? params.range! : "24h";
  const status = validStatuses.includes(params.status as typeof validStatuses[number]) ? params.status! : "ALL";
  const startDate = getAdminRangeStart(range)!;

  const allRangeTasks = await getUsageTasks({ startDate });
  const availableSizes = [...new Set(allRangeTasks.map((task) => task.size).filter(Boolean))].sort();
  const availableQualities = [...new Set(allRangeTasks.map((task) => task.quality).filter(Boolean))].sort();
  const selectedSize = params.size || "ALL";
  const selectedQuality = params.quality || "ALL";
  const tasks = await getUsageTasks({
    startDate,
    userId: params.userId,
    search: params.search?.trim(),
    status,
    size: selectedSize,
    quality: selectedQuality,
  });

  const summary = summarizeTasks(tasks);
  const userRows = groupByUser(tasks);
  const sizeRows = groupByField(tasks, "size");
  const qualityRows = groupByField(tasks, "quality");

  const cards = [
    { label: "任务数", value: formatNumber(summary.totalTasks), note: rangeLabel(range) },
    { label: "图片数", value: formatNumber(summary.imageCount), note: "生成图片总量" },
    { label: "积分消耗", value: formatNumber(summary.creditCost), note: "任务 totalCost 合计" },
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
          <h1>生成记录</h1>
          <p>按任务数、图片数、积分消耗、成功率、失败率、耗时、尺寸、质量和用户查看全站使用情况</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/users" className="ghost-button compact">用户管理</Link>
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

      <form className="usage-filters">
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
            <option value="SUCCESS">已完成</option>
            <option value="FAILED">失败</option>
            <option value="RUNNING">生成中</option>
            <option value="PENDING">排队中</option>
          </select>
        </label>
        <label>
          <span>尺寸</span>
          <select name="size" defaultValue={selectedSize}>
            <option value="ALL">全部尺寸</option>
            {availableSizes.map((size) => (
              <option value={size} key={size}>{size}</option>
            ))}
          </select>
        </label>
        <label>
          <span>质量</span>
          <select name="quality" defaultValue={selectedQuality}>
            <option value="ALL">全部质量</option>
            {availableQualities.map((quality) => (
              <option value={quality} key={quality}>{quality}</option>
            ))}
          </select>
        </label>
        {params.userId ? <input type="hidden" name="userId" value={params.userId} /> : null}
        <div className="usage-filter-actions">
          <button className="primary-button compact" type="submit">筛选</button>
          <Link href="/admin/usage" className="ghost-button compact">重置</Link>
        </div>
      </form>

      <section className="usage-dashboard-grid">
        <article className="usage-panel user-rank-panel">
          <header>
            <div>
              <h2>用户消耗排行</h2>
              <p>按积分消耗排序，查看谁生成最多、消耗最多。</p>
            </div>
            <span className="balance-pill">{rangeLabel(range)}</span>
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
                  <th>失败率</th>
                  <th>耗时</th>
                  <th>最后请求</th>
                </tr>
              </thead>
              <tbody>
                {userRows.length === 0 ? (
                  <tr><td colSpan={8} className="usage-empty-cell">暂无用户生成记录</td></tr>
                ) : userRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link className="usage-user-link" href={`/admin/usage?userId=${row.id}&range=${range}`}>
                        <strong>{row.email}</strong>
                        <small>{row.name}</small>
                      </Link>
                    </td>
                    <td>{formatNumber(row.tasks)}</td>
                    <td>{formatNumber(row.images)}</td>
                    <td>{formatNumber(row.credits)}</td>
                    <td>{rate(row.success, row.tasks)}</td>
                    <td>{rate(row.failed, row.tasks)}</td>
                    <td>{formatDuration(row.avgDuration)}</td>
                    <td>{formatDateTime(row.lastRequestedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <div className="usage-split-panels">
          <DistributionPanel title="尺寸分布" rows={sizeRows} />
          <DistributionPanel title="质量分布" rows={qualityRows} />
        </div>
      </section>

      <section className="usage-records">
        <header>
          <div>
            <h2>生成明细</h2>
            <p>最多展示当前筛选条件下最近 500 条任务。</p>
          </div>
          <Link className="ghost-button compact" href="/admin/usage">刷新</Link>
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
                <th>图片数</th>
                <th>积分消耗</th>
                <th>耗时</th>
                <th>Prompt 摘要</th>
                <th>错误信息</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr><td colSpan={11} className="usage-empty-cell">暂无生成记录</td></tr>
              ) : tasks.map((task) => (
                <tr key={task.id}>
                  <td>{formatDateTime(task.requestedAt)}</td>
                  <td>
                    <Link className="usage-user-link" href={`/admin/usage?userId=${task.userId}&range=${range}`}>
                      <strong>{task.user.email}</strong>
                      <small className="mono-cell">{task.id.slice(-8)}</small>
                    </Link>
                  </td>
                  <td><span className={`status-dot ${statusClass(task.status)}`}>{formatTaskStatus(task.status)}</span></td>
                  <td className="mono-cell">{task.size}</td>
                  <td>{task.quality}</td>
                  <td>{formatNumber(task.images.length || task.quantity)}</td>
                  <td>{formatNumber(task.totalCost)}</td>
                  <td>{formatDuration(getTaskDurationMs(task))}</td>
                  <td className="usage-prompt-cell" title={task.prompt}>{truncate(task.prompt)}</td>
                  <td className="usage-error-cell" title={task.rawError || task.errorMessage || ""}>{truncate(task.errorMessage || task.rawError || "—", 36)}</td>
                  <td>
                    <Link className="icon-action" href={`/admin/usage/${task.id}`}>
                      查看
                    </Link>
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

function DistributionPanel({
  title,
  rows,
}: {
  title: string;
  rows: ReturnType<typeof groupByField>;
}) {
  return (
    <article className="usage-panel">
      <header>
        <div>
          <h2>{title}</h2>
          <p>按任务参数聚合图片数、积分和完成质量。</p>
        </div>
      </header>
      <div className="usage-table-wrap">
        <table className="usage-mini-table">
          <thead>
            <tr>
              <th>项目</th>
              <th>任务</th>
              <th>图片</th>
              <th>积分</th>
              <th>成功率</th>
              <th>耗时</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="usage-empty-cell">暂无数据</td></tr>
            ) : rows.map((row) => (
              <tr key={row.label}>
                <td className="mono-cell">{row.label}</td>
                <td>{formatNumber(row.tasks)}</td>
                <td>{formatNumber(row.images)}</td>
                <td>{formatNumber(row.credits)}</td>
                <td>{rate(row.success, row.tasks)}</td>
                <td>{formatDuration(row.avgDuration)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
