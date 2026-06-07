export function withMessage(path: string, key: "error" | "success", message: string) {
  const url = new URL(path, "http://local");
  url.searchParams.set(key, message);
  return `${url.pathname}${url.search}`;
}
