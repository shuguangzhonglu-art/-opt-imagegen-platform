import Image from "next/image";
import Link from "next/link";
import type { Prisma } from "@prisma/client";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber, formatTaskStatus, getAdminRangeStart } from "@/lib/utils/format";


export const dynamic = "force-dynamic";
type AdminImagesPageProps = {
  searchParams?: Promise<{
    range?: string;
    search?: string;
    size?: string;
  }>;
};

const validRanges = ["today", "24h", "7d", "30d"] as const;
type ImageRow = Awaited<ReturnType<typeof getImages>>[number];

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

function truncate(value: string, maxLength = 48) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed || "—";
  return `${trimmed.slice(0, maxLength)}...`;
}

async function getImages(where: Prisma.GeneratedImageWhereInput) {
  return prisma.generatedImage.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      },
      task: {
        select: {
          id: true,
          prompt: true,
          status: true,
          size: true,
          quality: true,
          totalCost: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

function groupImagesBySize(images: ImageRow[]) {
  const map = new Map<string, ImageRow[]>();
  for (const image of images) {
    const size = image.task.size || `${image.width}x${image.height}`;
    const current = map.get(size) ?? [];
    current.push(image);
    map.set(size, current);
  }
  return [...map.entries()]
    .map(([size, rows]) => ({ size, images: rows }))
    .sort((a, b) => b.images.length - a.images.length);
}

export default async function AdminImagesPage({ searchParams }: AdminImagesPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const range = validRanges.includes(params.range as typeof validRanges[number]) ? params.range! : "24h";
  const search = params.search?.trim();
  const selectedSize = params.size || "ALL";
  const startDate = getAdminRangeStart(range)!;

  const baseWhere: Prisma.GeneratedImageWhereInput = {
    createdAt: { gte: startDate },
  };
  const allImages = await getImages(baseWhere);
  const availableSizes = [...new Set(allImages.map((image) => image.task.size || `${image.width}x${image.height}`))].sort();
  const where: Prisma.GeneratedImageWhereInput = {
    ...baseWhere,
    task: selectedSize !== "ALL" ? { size: selectedSize } : undefined,
    user: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { displayName: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
  };
  const images = await getImages(where);
  const sizeGroups = groupImagesBySize(images);

  const cards = [
    { label: "图片数", value: formatNumber(images.length), note: rangeLabel(range) },
    { label: "任务数", value: formatNumber(new Set(images.map((image) => image.taskId)).size), note: "关联生成任务" },
    { label: "尺寸数", value: formatNumber(sizeGroups.length), note: "当前筛选结果" },
    { label: "最近图片", value: images[0] ? formatDateTime(images[0].createdAt) : "—", note: "最新创建时间" },
  ];

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>图片资产</h1>
          <p>按尺寸分组查看全站生成图片。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/tasks" className="ghost-button compact">任务监控</Link>
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
          </select>
        </label>
        <label>
          <span>用户</span>
          <input name="search" type="search" placeholder="邮箱 / 昵称" defaultValue={params.search || ""} />
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
        <div className="usage-filter-actions">
          <button className="primary-button compact" type="submit">筛选</button>
          <Link href="/admin/images" className="ghost-button compact">重置</Link>
        </div>
      </form>

      <section className="usage-records">
        <header>
          <div>
            <h2>按尺寸查看</h2>
            <p>最多展示当前筛选条件下最近 300 张图片。</p>
          </div>
          <Link href="/admin/images" className="ghost-button compact">刷新</Link>
        </header>
        <div className="admin-size-sections">
          {sizeGroups.length === 0 ? (
            <div className="usage-empty-box">暂无图片资产</div>
          ) : sizeGroups.map((group) => (
            <section className="admin-size-section" key={group.size}>
              <div className="admin-size-heading">
                <h3>{group.size}</h3>
                <span>{formatNumber(group.images.length)} 张</span>
              </div>
              <div className="admin-image-grid">
                {group.images.map((image) => (
                  <article className="admin-image-asset" key={image.id}>
                    <a href={image.filePath} target="_blank" rel="noreferrer">
                      <Image src={image.filePath} alt="生成图片" width={image.width || 360} height={image.height || 360} />
                    </a>
                    <div>
                      <Link className="usage-user-link" href={`/admin/users/${image.userId}`}>
                        <strong>{image.user.email}</strong>
                        <small>{formatDateTime(image.createdAt)}</small>
                      </Link>
                      <p>{truncate(image.task.prompt, 64)}</p>
                      <div className="admin-image-meta">
                        <span>{image.width} × {image.height}</span>
                        <span>{image.task.quality}</span>
                        <span>{formatTaskStatus(image.task.status)}</span>
                      </div>
                      <Link href={`/admin/usage/${image.taskId}`} className="inline-green">查看任务</Link>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
