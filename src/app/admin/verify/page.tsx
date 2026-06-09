import Link from "next/link";

import { Notice } from "@/components/notice";
import { verifyAdminApiKeyAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";


export const dynamic = "force-dynamic";
type AdminVerifyPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    redirectTo?: string;
  }>;
};

export default async function AdminVerifyPage({ searchParams }: AdminVerifyPageProps) {
  const admin = await requireAdmin({ skipMfa: true });
  const params = (await searchParams) ?? {};
  const config = await getPlatformConfig();
  const redirectTo = params.redirectTo?.startsWith("/admin") ? params.redirectTo : "/admin";

  return (
    <main className="sub-admin-page admin-verify-page">
      <section className="admin-verify-card">
        <div>
          <p className="eyebrow">Admin Verification</p>
          <h1>管理员二次验证</h1>
          <p>输入管理员密钥后解锁后台。本次验证会在当前浏览器保留 12 小时。</p>
        </div>

        <Notice type="error" message={params.error} />
        <Notice type="success" message={params.success} />

        {config.adminMfaEnabled && config.adminApiKeyTail ? (
          <div className="admin-key-hint">
            当前密钥尾号：<strong>...{config.adminApiKeyTail}</strong>
          </div>
        ) : (
          <div className="admin-key-hint warning">
            尚未配置管理员密钥。请先到安全配置生成密钥。
          </div>
        )}

        <form action={verifyAdminApiKeyAction} className="admin-verify-form">
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label>
            <span>管理员密钥</span>
            <input name="adminApiKey" type="password" autoComplete="one-time-code" placeholder="adm_..." required />
          </label>
          <button className="primary-button compact" type="submit">解锁后台</button>
        </form>

        <footer>
          <span>{admin.email}</span>
          <Link href="/admin/security">安全配置</Link>
        </footer>
      </section>
    </main>
  );
}
