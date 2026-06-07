type NoticeProps = {
  type: "error" | "success";
  message?: string;
};

export function Notice({ type, message }: NoticeProps) {
  if (!message) return null;
  return <div className={`notice notice-${type}`}>{message}</div>;
}
