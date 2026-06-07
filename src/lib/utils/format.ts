export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function formatTaskStatus(status: string) {
  return (
    {
      PENDING: "排队中",
      RUNNING: "生成中",
      SUCCESS: "已完成",
      FAILED: "失败",
    }[status] ?? status
  );
}

export function formatCodeStatus(status: string) {
  return (
    {
      UNUSED: "未使用",
      REDEEMED: "已兑换",
      EXPIRED: "已过期",
      DISABLED: "已作废",
    }[status] ?? status
  );
}

export function formatUserStatus(status: string) {
  return status === "ACTIVE" ? "正常" : "已禁用";
}

export function formatRole(role: string) {
  return role === "ADMIN" ? "管理员" : "普通用户";
}

export function formatTransactionType(type: string) {
  return (
    {
      SIGNUP_BONUS: "注册赠送",
      ADMIN_ADJUSTMENT: "管理员调整",
      REDEEM_CODE: "卡密兑换",
      GENERATION_DEBIT: "图片生成消耗",
      GENERATION_REFUND: "生成失败返还",
    }[type] ?? type
  );
}
