"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", icon: "⌘", label: "仪表盘", exact: true },
  { href: "/admin/usage", icon: "▥", label: "使用记录" },
  { href: "/admin/tasks", icon: "↻", label: "任务监控" },
  { href: "/admin/images", icon: "□", label: "图片资产" },
  { href: "/admin/users", icon: "♙", label: "用户管理" },
  { href: "/admin/campaigns", icon: "✦", label: "活动积分" },
  { href: "/admin/invite-codes", icon: "◇", label: "邀请码" },
  { href: "/admin/redeem-codes", icon: "▣", label: "兑换码" },
  { href: "/admin/transactions", icon: "▤", label: "积分流水" },
  { href: "/admin/audit-logs", icon: "◷", label: "操作日志" },
  { href: "/admin/risk-control", icon: "◇", label: "风控中心" },
  { href: "/admin/security", icon: "○", label: "安全配置" },
  { href: "/admin/settings", icon: "⚙", label: "系统设置" },
];

export function AdminCenterNav() {
  const pathname = usePathname();

  return (
    <nav className="admin-center-nav" aria-label="后台模块">
      {navItems.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : undefined}>
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
