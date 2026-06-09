import Link from "next/link";

import { Notice } from "@/components/notice";
import { updateSettingsAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";


export const dynamic = "force-dynamic";
type AdminSettingsPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
  }>;
};

export default async function AdminSettingsPage({ searchParams }: AdminSettingsPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const config = await getPlatformConfig();
  const availableSizes = config.availableSizes.map((item) => `${item.label}:${item.cost}`).join(",");

  function initial(label: string) {
    return label.trim().charAt(0).toUpperCase();
  }

  return (
    <main className="sub-admin-page usage-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>设置中心</h1>
          <p>配置图片生成单价、可用尺寸、任务并发、文件保留和注册赠送积分。</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{initial(admin.displayName ?? admin.email)}</span>
          <span>
            <strong>{admin.displayName ?? "管理员"}</strong>
            <small>Admin</small>
          </span>
          <Link href="/admin/security" className="ghost-button compact">安全配置</Link>
          <Link href="/admin/risk-control" className="ghost-button compact">风控中心</Link>
          <Link href="/admin" className="ghost-button compact">后台总览</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <section className="security-settings">
        <article className="security-card">
          <div>
            <h2>生成与积分参数</h2>
            <p>尺寸价格格式为 size:cost，多项用英文逗号分隔，例如 1024x1024:40。</p>
          </div>
          <form action={updateSettingsAction} className="security-grid">
            <label>
              <span>默认单价</span>
              <input name="defaultUnitCost" type="number" min="1" defaultValue={config.defaultUnitCost} />
            </label>
            <label>
              <span>注册赠送积分</span>
              <input name="signupBonus" type="number" min="0" defaultValue={config.signupBonus} />
            </label>
            <label>
              <span>任务并发</span>
              <input name="taskConcurrency" type="number" min="1" defaultValue={config.taskConcurrency} />
            </label>
            <label>
              <span>文件保留天数</span>
              <input name="fileRetentionDays" type="number" min="1" defaultValue={config.fileRetentionDays} />
            </label>
            <label className="wide">
              <span>可用尺寸与价格</span>
              <input name="availableSizes" type="text" defaultValue={availableSizes} />
            </label>
            <div className="security-actions wide">
              <button className="primary-button compact" type="submit">保存设置</button>
            </div>
          </form>
        </article>
      </section>
    </main>
  );
}
