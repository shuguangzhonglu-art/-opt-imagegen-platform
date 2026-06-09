import Link from "next/link";

import { Notice } from "@/components/notice";
import { disableAdminApiKeyAction, generateAdminApiKeyAction, updateSecuritySettingsAction } from "@/lib/actions/admin-actions";
import { requireAdmin } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";


export const dynamic = "force-dynamic";
type SecurityPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    newAdminKey?: string;
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

      <div className="security-settings">
        <section className="security-card">
          <div>
            <h2>管理员二次验证密钥</h2>
            <p>开启后，管理员登录后台还必须输入密钥。密钥只显示一次，系统只保存哈希和尾号。</p>
          </div>
          {params.newAdminKey ? (
            <div className="admin-secret-reveal">
              <strong>请立即保存这个密钥，刷新后不再显示：</strong>
              <code>{params.newAdminKey}</code>
            </div>
          ) : null}
          <div className="admin-key-status-card">
            <div>
              <span>当前状态</span>
              <strong>{config.adminMfaEnabled && config.adminApiKeyTail ? "已启用" : "未启用"}</strong>
              <small>{config.adminApiKeyTail ? `密钥尾号 ...${config.adminApiKeyTail}` : "尚未生成管理员密钥"}</small>
            </div>
            <div className="toolbar-actions">
              <form action={generateAdminApiKeyAction}>
                <button className="primary-button compact" type="submit">
                  {config.adminApiKeyTail ? "重新生成" : "生成密钥"}
                </button>
              </form>
              {config.adminApiKeyTail ? (
                <form action={disableAdminApiKeyAction}>
                  <button className="ghost-button compact danger-button" type="submit">关闭</button>
                </form>
              ) : null}
            </div>
          </div>
        </section>
      </div>

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

        <section className="security-card">
          <div>
            <h2>邀请码注册</h2>
            <p>开启后，新用户注册必须填写有效邀请码；每个用户账户中心会自动拥有 5 个一次性邀请码。</p>
          </div>
          <label className="switch-row">
            <span>启用邀请码注册</span>
            <input name="registrationInviteEnabled" type="checkbox" defaultChecked={config.registrationInviteEnabled} />
          </label>
          <div className="toolbar-actions">
            <Link href="/admin/invite-codes" className="ghost-button compact">邀请码管理</Link>
          </div>
        </section>

        <section className="security-card">
          <div>
            <h2>新用户活动奖励</h2>
            <p>注册完成后自动发放短期活动积分，优先消耗，到期失效。</p>
          </div>
          <label className="switch-row">
            <span>启用活动奖励</span>
            <input name="signupActivityEnabled" type="checkbox" defaultChecked={config.signupActivityEnabled} />
          </label>
          <label className="switch-row">
            <span>仅邀请码注册用户可领</span>
            <input name="signupActivityInviteOnly" type="checkbox" defaultChecked={config.signupActivityInviteOnly} />
          </label>
          <div className="security-grid">
            <label>
              <span>奖励积分</span>
              <input name="signupActivityCredits" type="number" min="0" defaultValue={config.signupActivityCredits} />
            </label>
            <label>
              <span>有效期（小时）</span>
              <input name="signupActivityExpiresInHours" type="number" min="1" defaultValue={config.signupActivityExpiresInHours} />
            </label>
          </div>
        </section>

        <div className="security-actions">
          <Link href="/admin/users" className="ghost-button compact">返回用户</Link>
          <Link href="/admin/risk-control" className="ghost-button compact">风控中心</Link>
          <button type="submit" className="primary-button compact">保存配置</button>
        </div>
      </form>
    </main>
  );
}
