import fs from "node:fs/promises";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "public", "generated", "logs");
const LOG_FILE = path.join(LOG_DIR, "direct-image.log");

export async function appendDirectImageLog(
  event: string,
  payload: Record<string, unknown> = {},
) {
  await fs.mkdir(LOG_DIR, { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    event,
    ...payload,
  });

  await fs.appendFile(LOG_FILE, `${line}\n`, "utf8");
}

export function getDirectImageLogPath() {
  return LOG_FILE;
}
