import Link from "next/link";
import { redirect } from "next/navigation";

import { Notice } from "@/components/notice";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { registerAction, verifyRegisterCodeAction } from "@/lib/actions/auth-actions";
import { getCurrentSession } from "@/lib/auth";
import { getPlatformConfig } from "@/lib/config";

type RegisterPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    redirectTo?: string;
    step?: string;
    email?: string;
  }>;
};

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const params = (await searchParams) ?? {};
  const redirectTo = params.redirectTo || "/studio";
  const session = await getCurrentSession();
  const config = await getPlatformConfig();
  const isVerifyStep = params.step === "verify";
  const email = params.email || "";

  if (session) {
    redirect(redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/studio");
  }

  return (
    <main className="auth-page auth-login-page">
      <section className="auth-login-shell">
        <aside className="auth-login-side" aria-label="产品概览">
          <div className="auth-login-brand">
            <span>Hemora</span>
          </div>
          <p className="auth-login-tagline">想象成画</p>
        </aside>

        <section className="auth-card auth-login-card">
          <div className="auth-heading">
            <p className="eyebrow">IMAGE STUDIO</p>
            <h2>{isVerifyStep ? "验证邮箱" : "注册"}</h2>
          </div>
          <Notice type="error" message={params.error} />
          <Notice type="success" message={params.success} />
          {isVerifyStep ? (
            <form action={verifyRegisterCodeAction} className="auth-form">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <input type="hidden" name="email" value={email} />
              <label className="field">
                <span>验证码</span>
                <input
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6 位验证码"
                  minLength={6}
                  maxLength={6}
                  required
                />
              </label>
              <button type="submit" className="primary-button auth-login-submit">完成验证</button>
            </form>
          ) : (
            <form action={registerAction} className="auth-form">
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <label className="field">
                <span>邮箱</span>
                <input name="email" type="email" autoComplete="email" placeholder="name@example.com" required />
              </label>
              <label className="field">
                <span>用户名</span>
                <input name="displayName" type="text" autoComplete="nickname" placeholder="你的名字" minLength={2} maxLength={20} required />
              </label>
              <label className="field">
                <span>密码</span>
                <input name="password" type="password" autoComplete="new-password" placeholder="至少 8 位" minLength={8} required />
              </label>
              {config.registrationInviteEnabled ? (
                <label className="field">
                  <span>邀请码</span>
                  <input name="inviteCode" type="text" autoComplete="off" placeholder="INV-XXXXXX-XXXXXX" required />
                </label>
              ) : null}
              {config.turnstileEnabled ? (
                <div className="auth-verify">
                  <div>
                    <span>验证</span>
                    <strong>确认不是自动注册</strong>
                  </div>
                  <TurnstileWidget siteKey={config.turnstileSiteKey} />
                </div>
              ) : null}
              <button type="submit" className="primary-button auth-login-submit">发送验证码</button>
            </form>
          )}
          <p className="auth-hint">
            {isVerifyStep ? (
              <>
                邮箱填错了？<Link href={`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`}>重新注册</Link>
              </>
            ) : (
              <>
                已有账号？<Link href={`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`}>登录</Link>
              </>
            )}
          </p>
        </section>
      </section>
    </main>
  );
}
