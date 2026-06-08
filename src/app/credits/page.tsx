import Link from "next/link";

import { Notice } from "@/components/notice";
import { logoutAction } from "@/lib/actions/auth-actions";
import { redeemCodeAction, updateDisplayNameAction } from "@/lib/actions/user-actions";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDateTime, formatTransactionType } from "@/lib/utils/format";

type CreditsPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
  }>;
};

export default async function CreditsPage({ searchParams }: CreditsPageProps) {
  const user = await requireUser();
  const params = (await searchParams) ?? {};
  const [freshUser, transactions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      include: { wallet: true },
    }),
    prisma.creditTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return (
    <main className="admin-page credits-page">
      <header className="admin-head">
        <div>
          <p className="eyebrow">ACCOUNT</p>
          <h1>账户中心</h1>
        </div>
        <Link href="/studio" className="ghost-button">返回画布</Link>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="credits-grid">
        <div className="panel credits-balance-card">
          <span>余额</span>
          <strong>{freshUser?.wallet?.balance ?? 0}</strong>
          <p>可用于生成图片</p>
        </div>

        <form action={updateDisplayNameAction} className="panel credits-profile-card">
          <label>
            <span>用户名</span>
            <input
              name="displayName"
              type="text"
              defaultValue={freshUser?.displayName ?? ""}
              placeholder="输入用户名"
              maxLength={20}
              required
            />
          </label>
          <button type="submit" className="ghost-button">保存</button>
        </form>

        <form action={redeemCodeAction} className="panel credits-redeem-card">
          <label>
            <span>兑换券</span>
            <input name="code" type="text" placeholder="FC-XXXX-XXXX" autoComplete="off" required />
          </label>
          <button type="submit" className="primary-button">兑换</button>
        </form>

        <form action={logoutAction} className="panel credits-logout-card">
          <div>
            <span>会话</span>
            <strong>退出当前账户</strong>
          </div>
          <button type="submit" className="ghost-button">退出</button>
        </form>
      </section>

      <section className="panel admin-table-panel">
        <div className="credits-section-head">
          <h2>消耗记录</h2>
          <span>最近 30 条</span>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>变动</th>
              <th>余额</th>
              <th>备注</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((item) => (
              <tr key={item.id}>
                <td>{formatTransactionType(item.type)}</td>
                <td>{item.amount > 0 ? `+${item.amount}` : item.amount}</td>
                <td>{item.balanceAfter}</td>
                <td>{item.note}</td>
                <td>{formatDateTime(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
