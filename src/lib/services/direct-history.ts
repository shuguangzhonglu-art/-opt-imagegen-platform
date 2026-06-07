import crypto from "node:crypto";

import { prisma } from "@/lib/db";
import { normalizeStoredImageUrl } from "@/lib/services/object-storage";

const DIRECT_HISTORY_SALT = process.env.DIRECT_HISTORY_SALT || "direct-history-salt";
export const DIRECT_HISTORY_PAGE_SIZE = 12;

export type DirectHistoryImage = {
  filePath: string;
  width: number;
  height: number;
  prompt: string;
  size: string;
  createdAt: string;
};

function getDirectImageRecordModel() {
  const client = prisma as typeof prisma & {
    directImageRecord?: {
      createMany: (args: unknown) => Promise<unknown>;
      deleteMany: (args: unknown) => Promise<{ count: number }>;
      findMany: (args: unknown) => Promise<
        Array<{
          filePath: string;
          width: number;
          height: number;
          prompt: string;
          size: string;
          createdAt: Date;
        }>
      >;
    };
  };

  return client.directImageRecord;
}

export function hashUserApiKey(apiKey: string) {
  return crypto
    .createHash("sha256")
    .update(`${DIRECT_HISTORY_SALT}:${apiKey}`)
    .digest("hex");
}

export async function saveDirectHistory(params: {
  apiKey: string;
  prompt: string;
  size: string;
  sourceImagePath?: string;
  images: Array<{
    filePath: string;
    width: number;
    height: number;
  }>;
}) {
  const userKeyHash = hashUserApiKey(params.apiKey);
  const directImageRecord = getDirectImageRecordModel();
  if (!directImageRecord) {
    return;
  }

  await directImageRecord.createMany({
    data: params.images.map((image) => ({
      userKeyHash,
      prompt: params.prompt,
      size: params.size,
      filePath: image.filePath,
      width: image.width,
      height: image.height,
      sourceImagePath: params.sourceImagePath,
    })),
  });
}

export async function getDirectHistoryByApiKey(
  apiKey: string,
  options?: { offset?: number; limit?: number },
): Promise<DirectHistoryImage[]> {
  const userKeyHash = hashUserApiKey(apiKey);
  const directImageRecord = getDirectImageRecordModel();
  if (!directImageRecord) {
    return [];
  }

  const records = await directImageRecord.findMany({
    where: { userKeyHash },
    orderBy: { createdAt: "desc" },
    skip: options?.offset ?? 0,
    take: options?.limit ?? DIRECT_HISTORY_PAGE_SIZE,
  });

  return records.map((record) => ({
    filePath: normalizeStoredImageUrl(record.filePath),
    width: record.width,
    height: record.height,
    prompt: record.prompt,
    size: record.size,
    createdAt: record.createdAt.toISOString(),
  }));
}

export async function deleteDirectHistoryByFilePath(apiKey: string, filePath: string) {
  const directImageRecord = getDirectImageRecordModel();
  if (!directImageRecord) {
    return 0;
  }

  const userKeyHash = hashUserApiKey(apiKey);
  const result = await directImageRecord.deleteMany({
    where: {
      userKeyHash,
      filePath,
    },
  });

  return result.count;
}
