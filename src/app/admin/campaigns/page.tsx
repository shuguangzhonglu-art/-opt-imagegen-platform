import Link from "next/link";

import { Notice } from "@/components/notice";
import { createCreditCampaignAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

type CampaignsPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
  }>;
};

function adminInitial(label: string) {
  return label.trim().charAt(0).toUpperCase();
}

function campaignStatus(expiresAt: Date, nowTime: number) {
  return expiresAt.getTime() > nowTime ? "进行中" : "已过期";
}

export default async function AdminCampaignsPage({ searchParams }: CampaignsPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const campaigns = await prisma.creditCampaign.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      createdBy: {
        select: { email: true, displayName: true },
      },
      grants: {
        select: {
          amount: true,
          remaining: true,
          userId: true,
        },
      },
    },
  });
  const nowTime = new Date().getTime();

  const totalGranted = campaigns.reduce(
    (sum, campaign) => sum + campaign.grants.reduce((inner, grant) => inner + grant.amount, 0),
    0,
  );
  const totalRemaining = campaigns.reduce(
    (sum, campaign) => sum + campaign.grants.reduce((inner, grant) => inner + grant.remaining, 0),
    0,
  );
  const activeCampaignCount = campaigns.filter((campaign) => campaign.expiresAt.getTime() > nowTime).length;

  const cards = [
    { label: "活动数", value: formatNumber(campaigns.length), note: `${formatNumber(activeCampaignCount)} 个进行中` },
    { label: "发放积分", value: formatNumber(totalGranted), note: "最近 50 个活动" },
    { label: "已消耗", value: formatNumber(totalGranted - totalRemaining), note: "按积分包剩余计算" },
    { label: "未消耗", value: formatNumber(totalRemaining), note: "未过期部分仍可用" },
  ];

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>活动积分</h1>
          <p>创建短期积分活动，积分会优先于永久余额消耗。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{adminInitial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/users" className="ghost-button compact">用户管理</Link>
          <Link href="/admin/redeem-codes" className="ghost-button compact">兑换码</Link>
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="usage-summary-grid">
        {cards.map((card) => (
          <article className="usage-summary-card" key={card.label}>
            <p>{card.label}</p>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="usage-dashboard-grid">
        <article className="usage-panel">
          <header>
            <div>
              <h2>创建活动</h2>
              <p>适合一天体验、节日促活、定向补偿和新用户试用。</p>
            </div>
          </header>
          <form action={createCreditCampaignAction} className="usage-detail-body redeem-inline-form campaign-form">
            <label>
              <span>活动名称</span>
              <input name="name" type="text" placeholder="618 一日体验" required />
            </label>
            <label>
              <span>每人积分</span>
              <input name="creditAmount" type="number" min="1" placeholder="100" required />
            </label>
            <label>
              <span>过期时间</span>
              <input name="expiresAt" type="datetime-local" required />
            </label>
            <label>
              <span>发放对象</span>
              <select name="audience" defaultValue="selected">
                <option value="selected">指定用户</option>
                <option value="all-active">全部活跃用户</option>
              </select>
            </label>
            <label className="campaign-wide-field">
              <span>用户邮箱 / ID</span>
              <textarea name="recipients" rows={5} placeholder="每行一个邮箱或用户 ID，选择全部活跃用户时可留空" />
            </label>
            <label className="campaign-wide-field">
              <span>备注</span>
              <input name="description" type="text" placeholder="活动说明" />
            </label>
            <button type="submit" className="primary-button compact">创建并发放</button>
          </form>
        </article>

        <article className="usage-panel">
          <header>
            <div>
              <h2>消耗规则</h2>
              <p>所有生成任务统一按这个顺序扣费。</p>
            </div>
          </header>
          <div className="usage-detail-body">
            <dl className="usage-detail-list">
              <div>
                <dt>第一优先级</dt>
                <dd>最早过期的活动积分</dd>
              </div>
              <div>
                <dt>第二优先级</dt>
                <dd>其他未过期活动积分</dd>
              </div>
              <div>
                <dt>最后扣除</dt>
                <dd>永久积分余额</dd>
              </div>
              <div>
                <dt>失败退款</dt>
                <dd>退回原积分包，永久积分原路返还</dd>
              </div>
            </dl>
          </div>
        </article>
      </section>

      <section className="usage-records">
        <header>
          <div>
            <h2>活动列表</h2>
            <p>最近 50 个短期积分活动。</p>
          </div>
        </header>
        <div className="usage-table-wrap">
          <table className="sub-admin-table transactions-table">
            <thead>
              <tr>
                <th>活动</th>
                <th>状态</th>
                <th>每人积分</th>
                <th>用户数</th>
                <th>发放</th>
                <th>已消耗</th>
                <th>剩余</th>
                <th>过期时间</th>
                <th>创建人</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr><td colSpan={9} className="usage-empty-cell">暂无活动</td></tr>
              ) : campaigns.map((campaign) => {
                const granted = campaign.grants.reduce((sum, grant) => sum + grant.amount, 0);
                const remaining = campaign.grants.reduce((sum, grant) => sum + grant.remaining, 0);
                const userCount = new Set(campaign.grants.map((grant) => grant.userId)).size;
                const isActive = campaign.expiresAt.getTime() > nowTime;

                return (
                  <tr key={campaign.id}>
                    <td>
                      <strong>{campaign.name}</strong>
                      <small className="muted-cell">{campaign.description || "—"}</small>
                    </td>
                    <td><span className={isActive ? "status-dot ok" : "status-dot muted"}>{campaignStatus(campaign.expiresAt, nowTime)}</span></td>
                    <td>{formatNumber(campaign.creditAmount)}</td>
                    <td>{formatNumber(userCount)}</td>
                    <td>{formatNumber(granted)}</td>
                    <td>{formatNumber(granted - remaining)}</td>
                    <td>{formatNumber(remaining)}</td>
                    <td>{formatDateTime(campaign.expiresAt)}</td>
                    <td>{campaign.createdBy?.displayName ?? campaign.createdBy?.email ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
