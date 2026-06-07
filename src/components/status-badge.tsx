type StatusBadgeProps = {
  tone: "pending" | "running" | "success" | "failed" | "neutral";
  label: string;
};

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  return <span className={`status-badge tone-${tone}`}>{label}</span>;
}
