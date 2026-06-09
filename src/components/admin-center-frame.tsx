"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AdminCenterNav } from "@/components/admin-center-nav";

type AdminCenterFrameProps = {
  email?: string;
  displayName?: string | null;
  children: React.ReactNode;
};

export function AdminCenterFrame({ email, displayName, children }: AdminCenterFrameProps) {
  const pathname = usePathname();

  if (pathname === "/admin/verify") {
    return <>{children}</>;
  }

  const accountName = displayName || email?.split("@")[0] || "管理员";

  return (
    <div className="admin-center-shell">
      <aside className="admin-center-sidebar">
        <Link href="/admin" className="admin-center-brand">
          <span className="admin-center-brand-mark">H</span>
          <span>
            <strong>Hemora</strong>
            <small>Admin Center</small>
          </span>
        </Link>
        <AdminCenterNav />
      </aside>

      <div className="admin-center-main">
        <header className="admin-center-header">
          <div>
            <span>后台中心</span>
            <strong>运营管理</strong>
          </div>
          <div className="admin-center-account">
            <span className="admin-avatar">{accountName.charAt(0).toUpperCase()}</span>
            <span>
              <strong>{accountName}</strong>
              <small>管理员</small>
            </span>
            <Link href="/studio" className="ghost-button compact">返回画布</Link>
          </div>
        </header>
        <div className="admin-center-content">{children}</div>
      </div>
    </div>
  );
}
