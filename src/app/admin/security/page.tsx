import Link from "next/link";

import { Notice } from "@/components/notice";
import { updateSecuritySettingsAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";

type SecurityPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
  }>;
};

export default async function AdminSecurityPage({ searchParams }: SecurityPageProps) {
  const admin = await requireAdmin();
  const params = (await searchParams) ?? {};
  const config = await getPlatformConfig();

  return (
    <main className="sub-admin-page">
      <header className="sub-admin-topbar">
        <div>
          <h1>安全配置</h1>
          <p>邮箱验证、防机器人、注册限流</p>
        </div>
        <div className="sub-admin-account">
          <span className="admin-avatar">{admin.email.charAt(0).toUpperCase()}</span>
          <span>
            <strong>{admin.email.split("@")[0]}</strong>
            <small>Admin</small>
          </span>
          <Link href="/studio" className="ghost-button compact">返回画布</Link>
        </div>
      </header>

      <Notice type="error" message={params.error} />
      <Notice type="success" message={params.success} />

      <form action={updateSecuritySettingsAction} className="security-settings">
        <section className="security-card">
          <div>
            <h2>注册邮箱验证</h2>
            <p>开启后，新用户必须输入邮箱验证码后才能登录和获得注册送积分。</p>
          </div>
          <label className="switch-row">
            <span>启用邮箱验证</span>
            <input name="emailVerificationEnabled" type="checkbox" defaultChecked={config.emailVerificationEnabled} />
          </label>
        </section>

        <section className="security-card">
          <div>
            <h2>SMTP 发信配置</h2>
            <p>不填 SMTP 时，本地会把验证链接打印在服务日志里。</p>
          </div>
          <div className="security-grid">
            <label>
              <span>SMTP Host</span>
              <input name="smtpHost" type="text" placeholder="smtp.qq.com" defaultValue={config.smtpHost} />
            </label>
            <label>
              <span>SMTP Port</span>
              <input name="smtpPort" type="number" min="1" defaultValue={config.smtpPort} />
            </label>
            <label>
              <span>SMTP User</span>
              <input name="smtpUser" type="text" placeholder="name@example.com" defaultValue={config.smtpUser} />
            </label>
            <label>
              <span>SMTP Password</span>
              <input name="smtpPassword" type="password" placeholder={config.smtpPassword ? "已保存，留空会清空" : "授权码/密码"} defaultValue={config.smtpPassword} />
            </label>
            <label className="wide">
              <span>From</span>
              <input name="smtpFrom" type="text" placeholder="Image Studio <name@example.com>" defaultValue={config.smtpFrom} />
            </label>
          </div>
        </section>

        <section className="security-card">
          <div>
            <h2>Cloudflare Turnstile</h2>
            <p>注册页机器人验证，适合防批量注册。</p>
          </div>
          <label className="switch-row">
            <span>启用 Turnstile</span>
            <input name="turnstileEnabled" type="checkbox" defaultChecked={config.turnstileEnabled} />
          </label>
          <div className="security-grid">
            <label>
              <span>Site Key</span>
              <input name="turnstileSiteKey" type="text" defaultValue={config.turnstileSiteKey} />
            </label>
            <label>
              <span>Secret Key</span>
              <input name="turnstileSecretKey" type="password" defaultValue={config.turnstileSecretKey} />
            </label>
          </div>
        </section>

        <section className="security-card">
          <div>
            <h2>注册限流</h2>
            <p>按邮箱域名做基础限流，先挡掉低成本刷号。</p>
          </div>
          <label className="switch-row">
            <span>启用注册限流</span>
            <input name="registerRateLimitEnabled" type="checkbox" defaultChecked={config.registerRateLimitEnabled} />
          </label>
          <div className="security-grid">
            <label>
              <span>时间窗口（分钟）</span>
              <input name="registerRateLimitWindowMinutes" type="number" min="1" defaultValue={config.registerRateLimitWindowMinutes} />
            </label>
            <label>
              <span>最多注册数</span>
              <input name="registerRateLimitMax" type="number" min="1" defaultValue={config.registerRateLimitMax} />
            </label>
          </div>
        </section>

        <div className="security-actions">
          <Link href="/admin/users" className="ghost-button compact">返回用户</Link>
          <button type="submit" className="primary-button compact">保存配置</button>
        </div>
      </form>
    </main>
  );
}
