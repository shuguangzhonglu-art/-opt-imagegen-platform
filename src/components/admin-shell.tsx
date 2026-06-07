import Link from "next/link";

import { logoutAction } from "@/lib/actions/auth-actions";

type AdminShellProps = {
  title: string;
  description: string;
  email: string;
  children: React.ReactNode;
};

const links = [
  { href: "/admin", label: "概览" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/redeem-codes", label: "卡券管理" },
  { href: "/admin/tasks", label: "任务记录" },
  { href: "/admin/transactions", label: "积分流水" },
  { href: "/admin/settings", label: "设置中心" },
];

export function AdminShell({ title, description, email, children }: AdminShellProps) {
  return (
    <div className="app-frame admin-frame">
      <aside className="sidebar-panel">
        <div className="brand-lockup">
          <div className="brand-icon">AD</div>
          <div className="brand-copy">
            <p className="eyebrow">管理中心</p>
            <h1>管理后台</h1>
          </div>
        </div>

        <nav className="stack-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="nav-item">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="user-card">
          <strong className="text-ellipsis">{email}</strong>
          <p>平台管理员</p>
        </div>

        <form action={logoutAction}>
          <button className="ghost-button full-width" type="submit">
            退出后台
          </button>
        </form>
      </aside>

      <main className="content-shell">
        <div className="page-head">
          <div>
            <p className="eyebrow">后台管理</p>
            <h2>{title}</h2>
          </div>
          <p className="page-copy">{description}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
