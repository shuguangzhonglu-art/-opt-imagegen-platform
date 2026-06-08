import Link from "next/link";

import { Notice } from "@/components/notice";
import { disableRedeemCodeAction, generateRedeemCodesAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatCodeStatus, formatDateTime } from "@/lib/utils/format";

type RedeemCodesPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
  }>;
};

export default async function AdminRedeemCodesPage({ searchParams }: RedeemCodesPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const codes = await prisma.redeemCode.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      redeemedBy: {
        select: { email: true },
      },
    },
  });
  const wallet = await prisma.wallet.findUnique({ where: { userId: admin.id } });

  function adminInitial(email: string) {
    return email.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>兑换码管理</h1>
          <p>生成和管理兑换码</p>
        </div>
        <div className="sub-admin-account">
          <span className="balance-pill">{wallet?.balance ?? 0} 积分</span>
          <span className="admin-avatar">{adminInitial(admin.email)}</span>
          <span>
            <strong>{admin.email.split("@")[0]}</strong>
            <small>Admin</small>
          </span>
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="sub-admin-toolbar redeem-toolbar">
        <input className="admin-filter-input" type="search" placeholder="搜索兑换码或邮箱..." />
        <select className="admin-filter-select" defaultValue="all">
          <option value="all">全部类型</option>
          <option value="credits">余额</option>
        </select>
        <select className="admin-filter-select" defaultValue="all">
          <option value="all">全部状态</option>
          <option value="UNUSED">未使用</option>
          <option value="REDEEMED">已兑换</option>
          <option value="DISABLED">已作废</option>
        </select>
        <div className="toolbar-actions">
          <button className="ghost-button compact" type="button">刷新</button>
          <Link href="/admin/security" className="ghost-button compact">安全配置</Link>
          <Link href="/admin/risk-control" className="ghost-button compact">风控中心</Link>
          <button className="ghost-button compact" type="button">导出 CSV</button>
          <details className="admin-modal-trigger">
            <summary className="primary-button compact">生成兑换码</summary>
            <div className="admin-modal-backdrop">
              <div className="admin-modal-card">
                <h2>生成兑换码</h2>
                <form action={generateRedeemCodesAction} className="modal-form">
                  <label>
                    <span>类型</span>
                    <select defaultValue="balance" disabled>
                      <option value="balance">余额</option>
                    </select>
                  </label>
                  <label>
                    <span>面额</span>
                    <input name="creditAmount" type="number" min="1" placeholder="100" required />
                  </label>
                  <label>
                    <span>批次</span>
                    <input name="batchName" type="text" placeholder="客户充值" defaultValue="客户充值" required />
                  </label>
                  <div>
                    <span className="modal-label">兑换码过期</span>
                    <div className="expiry-grid">
                      <label><input type="radio" name="expiresPreset" defaultChecked /> 永不过期</label>
                      <label><input type="radio" name="expiresPreset" /> 1 天</label>
                      <label><input type="radio" name="expiresPreset" /> 3 天</label>
                      <label><input type="radio" name="expiresPreset" /> 7 天</label>
                    </div>
                  </div>
                  <label>
                    <span>自定义过期</span>
                    <input name="expiresAt" type="date" />
                  </label>
                  <label>
                    <span>数量</span>
                    <input name="quantity" type="number" min="1" max="500" defaultValue="1" required />
                  </label>
                  <div className="modal-actions">
                    <Link href="/admin/redeem-codes" className="ghost-button compact">取消</Link>
                    <button type="submit" className="primary-button compact">生成</button>
                  </div>
                </form>
              </div>
            </div>
          </details>
        </div>
      </section>

      <section className="sub-table-card">
        <table className="sub-admin-table">
          <thead>
            <tr>
              <th></th>
              <th>兑换券</th>
              <th>类型</th>
              <th>面额</th>
              <th>状态</th>
              <th>兑换用户</th>
              <th>使用时间</th>
              <th>过期时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((code) => (
              <tr key={code.id}>
                <td><span className="checkbox-fake" /></td>
                <td>
                  <code className="redeem-code-text">{code.code}</code>
                </td>
                <td><span className="role-pill green">余额</span></td>
                <td><strong>{code.creditAmount}</strong></td>
                <td><span className="role-pill">{formatCodeStatus(code.status)}</span></td>
                <td>{code.redeemedBy?.email ?? "—"}</td>
                <td>{formatDateTime(code.redeemedAt)}</td>
                <td>{code.expiresAt ? formatDateTime(code.expiresAt) : "永不过期"}</td>
                <td>
                  {code.status === "UNUSED" ? (
                    <form action={disableRedeemCodeAction}>
                      <input type="hidden" name="codeId" value={code.id} />
                      <button type="submit" className="icon-action">作废</button>
                    </form>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
