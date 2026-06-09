import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatTaskStatus, formatTransactionType } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type UsageTaskDetailPageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

type DetailTask = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

function getTaskDurationMs(task: Pick<DetailTask, "requestedAt" | "startedAt" | "finishedAt">) {
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

function parseSourceImages(task: Pick<DetailTask, "sourceImagePath" | "sourceImagePaths">) {
  const sources = new Set<string>();
  if (task.sourceImagePath) sources.add(task.sourceImagePath);

  if (task.sourceImagePaths) {
    try {
      const parsed = JSON.parse(task.sourceImagePaths);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item) sources.add(item);
        }
      }
    } catch {
      for (const item of task.sourceImagePaths.split(",")) {
        const trimmed = item.trim();
        if (trimmed) sources.add(trimmed);
      }
    }
  }

  return [...sources];
}

async function getTaskDetail(taskId: string) {
  return prisma.generationTask.findUnique({
    where: { id: taskId },
    include: {
      user: {
        include: {
          wallet: true,
        },
      },
      images: {
        orderBy: { createdAt: "asc" },
      },
      transactions: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export default async function AdminUsageTaskDetailPage({ params }: UsageTaskDetailPageProps) {
  const admin = await requireAdmin();
  const { taskId } = await params;
  const task = await getTaskDetail(taskId);

  if (!task) {
    notFound();
  }

  const durationMs = getTaskDurationMs(task);
  const sourceImages = parseSourceImages(task);
  const generatedImageCount = task.images.length || task.quantity;
  const transactionTotal = task.transactions.reduce((sum, transaction) => sum + transaction.amount, 0);

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  const summaryCards = [
    { label: "状态", value: formatTaskStatus(task.status), note: task.id.slice(-8) },
    { label: "图片数", value: formatNumber(generatedImageCount), note: `请求数量 ${formatNumber(task.quantity)}` },
    { label: "积分消耗", value: formatNumber(task.totalCost), note: `单张 ${formatNumber(task.unitCost)} 积分` },
    { label: "生成耗时", value: formatDuration(durationMs), note: "开始到完成" },
    { label: "尺寸", value: task.size, note: task.quality },
    { label: "重试次数", value: formatNumber(task.retryCount), note: task.queueJobId ? `Job ${task.queueJobId}` : "无队列 Job" },
  ];

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>任务详情</h1>
          <p>查看图片生成任务的请求时间、生成耗时、积分流水、Prompt、图片和错误信息</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href={`/admin/usage?userId=${task.userId}`} className="ghost-button compact">该用户记录</Link>
          <Link href={`/admin/transactions?search=${encodeURIComponent(task.user.email)}`} className="ghost-button compact">积分流水</Link>
          <Link href="/admin/usage" className="ghost-button compact">返回生成记录</Link>
        </div>
      </header>

      <section className="usage-summary-grid">
        {summaryCards.map((card) => (
          <article className="usage-summary-card" key={card.label}>
            <p>{card.label}</p>
            <strong className={card.label === "状态" ? `status-text ${statusClass(task.status)}` : undefined}>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="usage-detail-grid">
        <article className="usage-panel usage-detail-main">
          <header>
            <div>
              <h2>请求内容</h2>
              <p>完整 Prompt 和任务参数。</p>
            </div>
            <span className={`status-dot ${statusClass(task.status)}`}>{formatTaskStatus(task.status)}</span>
          </header>
          <div className="usage-detail-body">
            <dl className="usage-detail-list">
              <div>
                <dt>任务 ID</dt>
                <dd className="mono-cell">{task.id}</dd>
              </div>
              <div>
                <dt>用户</dt>
                <dd>
                  <Link className="usage-user-link" href={`/admin/usage?userId=${task.userId}`}>
                    <strong>{task.user.email}</strong>
                    <small>{task.user.displayName ?? "未设置"} · 余额 {formatNumber(task.user.wallet?.balance ?? 0)}</small>
                  </Link>
                </dd>
              </div>
              <div>
                <dt>参数</dt>
                <dd>{task.size} · {task.quality} · {task.style || "默认风格"}</dd>
              </div>
              <div>
                <dt>完整 Prompt</dt>
                <dd className="usage-prompt-block">{task.prompt}</dd>
              </div>
            </dl>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>时间线</h2>
              <p>请求、排队、开始和完成时间。</p>
            </div>
          </header>
          <div className="usage-detail-body">
            <ol className="usage-timeline">
              <li><span>请求</span><strong>{formatDateTime(task.requestedAt)}</strong></li>
              <li><span>入队</span><strong>{formatDateTime(task.queuedAt)}</strong></li>
              <li><span>开始</span><strong>{formatDateTime(task.startedAt)}</strong></li>
              <li><span>完成</span><strong>{formatDateTime(task.finishedAt)}</strong></li>
              <li><span>总耗时</span><strong>{formatDuration(durationMs)}</strong></li>
            </ol>
          </div>
        </article>
      </section>

      <section className="usage-detail-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>生成图片</h2>
              <p>任务产出的图片结果。</p>
            </div>
            <span className="balance-pill">{formatNumber(task.images.length)} 张</span>
          </header>
          <div className="usage-image-grid">
            {task.images.length === 0 ? (
              <div className="usage-empty-box">暂无生成图片</div>
            ) : task.images.map((image) => (
              <a className="usage-image-card" href={image.filePath} target="_blank" rel="noreferrer" key={image.id}>
                <Image src={image.filePath} alt="生成图片" width={image.width || 360} height={image.height || 360} />
                <span>{image.width} × {image.height}</span>
              </a>
            ))}
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>源图</h2>
              <p>用户上传或传入的参考图。</p>
            </div>
            <span className="balance-pill">{formatNumber(sourceImages.length)} 张</span>
          </header>
          <div className="usage-image-grid">
            {sourceImages.length === 0 ? (
              <div className="usage-empty-box">无源图</div>
            ) : sourceImages.map((source) => (
              <a className="usage-image-card" href={source} target="_blank" rel="noreferrer" key={source}>
                <Image src={source} alt="源图" width={360} height={360} />
                <span className="text-ellipsis">{source}</span>
              </a>
            ))}
          </div>
        </article>
      </section>

      <section className="usage-detail-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>积分流水</h2>
              <p>和这个任务关联的扣费、退款或调整记录。</p>
            </div>
            <span className="balance-pill">合计 {formatNumber(transactionTotal)}</span>
          </header>
          <div className="usage-table-wrap">
            <table className="usage-mini-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>变动</th>
                  <th>变动后余额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {task.transactions.length === 0 ? (
                  <tr><td colSpan={5} className="usage-empty-cell">暂无关联积分流水</td></tr>
                ) : task.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatDateTime(transaction.createdAt)}</td>
                    <td>{formatTransactionType(transaction.type)}</td>
                    <td>{formatNumber(transaction.amount)}</td>
                    <td>{formatNumber(transaction.balanceAfter)}</td>
                    <td>{transaction.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>错误信息</h2>
              <p>失败任务和上游异常排查。</p>
            </div>
          </header>
          <div className="usage-detail-body">
            {task.errorMessage || task.rawError ? (
              <div className="usage-error-block">
                {task.errorMessage ? <strong>{task.errorMessage}</strong> : null}
                {task.rawError ? <pre>{task.rawError}</pre> : null}
              </div>
            ) : (
              <div className="usage-empty-box">暂无错误信息</div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
