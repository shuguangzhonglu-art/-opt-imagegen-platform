import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");

type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
};

function getObjectStorageConfig(): ObjectStorageConfig | null {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim();
  const region = process.env.OBJECT_STORAGE_REGION?.trim() || "auto";
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim();
  const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();
  const publicBaseUrl = process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim();

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
  };
}

function getObjectStorageClient(config: ObjectStorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

function getPublicFileUrl(config: ObjectStorageConfig, key: string) {
  const normalizedKey = key.replace(/^\/+/, "");
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/+$/, "")}/${normalizedKey}`;
  }

  return `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}/${normalizedKey}`;
}

export function normalizeStoredImageUrl(filePath: string) {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    return normalizedPath;
  }

  if (normalizedPath.startsWith("/")) {
    return normalizedPath;
  }

  const config = getObjectStorageConfig();
  const publicBaseUrl = config?.publicBaseUrl?.replace(/\/+$/, "");
  if (!publicBaseUrl) {
    return normalizedPath;
  }

  try {
    const parsed = new URL(normalizedPath);
    if (!/\.r2\.dev$/i.test(parsed.hostname)) {
      return normalizedPath;
    }

    return `${publicBaseUrl}${parsed.pathname}`;
  } catch {
    return normalizedPath;
  }
}

function getContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "image/png";
}

function buildStorageKey(fileName: string) {
  const date = new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const token = crypto.randomUUID().slice(0, 8);
  return `generated/${year}/${month}/${token}-${fileName}`;
}

export function isObjectStorageEnabled() {
  return Boolean(getObjectStorageConfig());
}

export async function uploadGeneratedFile(localPathOrUrl: string) {
  const config = getObjectStorageConfig();
  if (!config) {
    return localPathOrUrl;
  }

  if (/^https?:\/\//i.test(localPathOrUrl)) {
    return localPathOrUrl;
  }

  const relativePath = localPathOrUrl.replace(/^\/+/, "");
  const absolutePath = path.join(process.cwd(), "public", relativePath);
  const fileName = path.basename(relativePath);
  const fileBytes = await fs.readFile(absolutePath);
  const key = buildStorageKey(fileName);
  const client = getObjectStorageClient(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: fileBytes,
      ContentType: getContentType(fileName),
    }),
  );

  await fs.unlink(absolutePath).catch(() => null);
  return getPublicFileUrl(config, key);
}

export async function uploadGeneratedBuffer(input: {
  buffer: Buffer;
  fileName: string;
}) {
  const config = getObjectStorageConfig();
  if (!config) {
    const localPath = path.join(GENERATED_DIR, input.fileName);
    await fs.writeFile(localPath, input.buffer);
    return `/generated/${input.fileName}`;
  }

  const key = buildStorageKey(input.fileName);
  const client = getObjectStorageClient(config);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.buffer,
      ContentType: getContentType(input.fileName),
    }),
  );

  return getPublicFileUrl(config, key);
}

export async function readReferenceImageBuffer(sourceImagePath?: string) {
  if (!sourceImagePath) return null;

  if (/^https?:\/\//i.test(sourceImagePath)) {
    const response = await fetch(sourceImagePath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`下载参考图失败（${response.status}）`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const relativePath = sourceImagePath.replace(/^\/+/, "");
  const absolutePath = path.join(process.cwd(), "public", relativePath);
  return fs.readFile(absolutePath);
}
