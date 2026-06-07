import Link from "next/link";

import { logoutAction } from "@/lib/actions/auth-actions";

type UserShellProps = {
  title: string;
  description: string;
  email: string;
  role: string;
  children: React.ReactNode;
};

const links = [
  { href: "/", label: "首页" },
  { href: "/studio", label: "生成工作台" },
  { href: "/templates", label: "模版中心" },
  { href: "/credits", label: "积分中心" },
  { href: "/library", label: "作品库" },
  { href: "/account", label: "账户" },
];

export function UserShell({ title, description, email, role, children }: UserShellProps) {
  return (
    <div className="app-frame">
      <aside className="sidebar-panel">
        <div className="brand-lockup">
          <div className="brand-icon">FC</div>
          <div className="brand-copy">
            <p className="eyebrow">智能图片站</p>
            <h1>Flux Image</h1>
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
          <p>{role === "ADMIN" ? "管理员账户" : "我的创作账户"}</p>
        </div>

        <form action={logoutAction}>
          <button className="ghost-button full-width" type="submit">
            退出登录
          </button>
        </form>
      </aside>

      <main className="content-shell">
        <div className="page-head">
          <div>
            <p className="eyebrow">创作空间</p>
            <h2>{title}</h2>
          </div>
          <p className="page-copy">{description}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
