import Link from "next/link";

import { Notice } from "@/components/notice";
import { loginAction } from "@/lib/actions/auth-actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    success?: string;
    redirectTo?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const redirectTo = params.redirectTo || "/";

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
            <p className="eyebrow">WELCOME BACK</p>
            <h2>登录</h2>
          </div>
          <Notice type="error" message={params.error} />
          <Notice type="success" message={params.success} />
          <form action={loginAction} className="auth-form">
            <input type="hidden" name="redirectTo" value={redirectTo} />
            <label className="field">
              <span>邮箱</span>
              <input name="email" type="email" autoComplete="email" placeholder="name@example.com" required />
            </label>
            <label className="field">
              <span>密码</span>
              <input name="password" type="password" autoComplete="current-password" placeholder="输入密码" required />
            </label>
            <button type="submit" className="primary-button auth-login-submit">登录</button>
          </form>
          <div className="auth-divider">
            <span />
            <em>或</em>
            <span />
          </div>
          <button type="button" className="auth-google-button">
            <strong>G</strong>
            使用 Google 继续
          </button>
          <p className="auth-hint">
            还没有账号？<Link href={`/auth/register?redirectTo=${encodeURIComponent(redirectTo)}`}>立即注册</Link>
          </p>
        </section>
      </section>
    </main>
  );
}
