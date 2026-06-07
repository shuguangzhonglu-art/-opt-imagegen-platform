import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import OpenAI from "openai";

import { appendDirectImageLog } from "@/lib/services/direct-log";
import {
  readReferenceImageBuffer,
  uploadGeneratedBuffer,
} from "@/lib/services/object-storage";

type GenerateImageInput = {
  prompt: string;
  sourceImagePath?: string;
  sourceImagePaths?: string[];
  style: string;
  size: string;
  quality: string;
  background?: "auto" | "opaque" | "transparent";
  quantity: number;
  taskId: string;
};

type GeneratedAsset = {
  filePath: string;
  width: number;
  height: number;
};

type ImageClientOptions = {
  apiKey: string;
  baseURL?: string;
  model?: string;
  wireApi?: "responses" | "images";
};

type UploadedReferenceImage = {
  filePath: string;
  width: number;
  height: number;
};

type OpenAiRequestOptions = {
  apiKey?: string;
  baseURL?: string;
};

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
const OPENAI_REQUEST_TIMEOUT_MS = Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 120000);
const RESPONSES_RETRY_LIMIT = 2;
const RESPONSES_POLL_INTERVAL_MS = 3000;
const RESPONSES_POLL_TIMEOUT_MS = Number(process.env.OPENAI_RESPONSES_POLL_TIMEOUT_MS || 300000);

function getImageDimensions(size: string) {
  const [width, height] = size.split("x").map(Number);
  return { width, height };
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return createOpenAIClient({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

function createOpenAIClient(options: { apiKey: string; baseURL?: string }) {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
  });
}

function getOpenAIModel() {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
}

function getOpenAIWireApi() {
  return process.env.OPENAI_WIRE_API || "images";
}

function getFallbackImageModel() {
  return process.env.OPENAI_FALLBACK_IMAGE_MODEL || "gpt-image-2";
}

function formatOpenAIError(error: unknown, model: string) {
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 500;
    const message = error.message || "上游图片接口返回错误";

    if (status === 401) {
      return `图片接口鉴权失败，请检查 API key 是否可用。模型：${model}`;
    }

    if (status === 403) {
      return `图片请求被上游网关拦截。请检查模型权限、网关风控策略或提示词审核。模型：${model}`;
    }

    if (status === 404) {
      return `上游网关未找到图片模型或接口。请检查模型名和 base URL。模型：${model}`;
    }

    if (status === 429) {
      return `图片接口请求过多或额度不足，请稍后重试。模型：${model}`;
    }

    return `图片接口调用失败（${status}）：${message}`;
  }

  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return `图片生成超时，等待上游结果过久。模型：${model}`;
    }
    if (error.message === "fetch failed") {
      const cause =
        "cause" in error
          ? String((error as Error & { cause?: unknown }).cause ?? "")
          : "";
      if (cause) {
        return `上游图片接口连接被中断：${cause}。模型：${model}`;
      }
      return `上游图片接口连接失败。模型：${model}`;
    }
    if (error.message.includes("aborted due to timeout")) {
      return `图片生成超时，等待上游结果过久。模型：${model}`;
    }
    return error.message;
  }

  return "未知图片接口错误";
}

function logImageProviderError(context: {
  provider: string;
  baseURL: string;
  model: string;
  taskId: string;
  error: unknown;
  sourceImagePath?: string;
  wireApi?: string;
}) {
  const errorMessage =
    context.error instanceof Error ? context.error.message : String(context.error);
  const errorCause =
    context.error instanceof Error && "cause" in context.error
      ? String((context.error as Error & { cause?: unknown }).cause ?? "")
      : "";

  console.error(
    [
      "image-provider",
      `provider=${context.provider}`,
      `baseURL=${context.baseURL}`,
      `model=${context.model}`,
      `taskId=${context.taskId}`,
      context.wireApi ? `wireApi=${context.wireApi}` : "",
      context.sourceImagePath ? `sourceImagePath=${context.sourceImagePath}` : "",
      `error=${errorMessage}`,
      errorCause ? `cause=${errorCause}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function normalizeOpenAISize(size: string, model: string): "1024x1024" | "1536x1024" | "1024x1536" | "1792x1024" | "1024x1792" {
  const { width, height } = getImageDimensions(size);

  if (model === "dall-e-3") {
    if (width > height) return "1792x1024";
    if (height > width) return "1024x1792";
    return "1024x1024";
  }

  if (size === "1024x1024" || size === "1536x1024" || size === "1024x1536") return size;
  if (width > height) return "1536x1024";
  if (height > width) return "1024x1536";
  return "1024x1024";
}

function getOpenAIImageCount(model: string, quantity: number) {
  if (model === "dall-e-3") return 1;
  return quantity;
}

function getOpenAIQuality(model: string, quality: string): "low" | "medium" | "high" | "auto" | "standard" | "hd" {
  if (model === "dall-e-3") {
    return quality.includes("高") ? "hd" : "standard";
  }

  return mapQualityToOpenAI(quality);
}

function buildPrompt(input: GenerateImageInput) {
  return input.prompt.trim();
}

function mapQualityToOpenAI(quality: string) {
  return quality.includes("高") ? "high" : "medium";
}

function getResponsesImageQuality(quality: string) {
  return quality.includes("高") ? "high" : "medium";
}

function shouldRetryResponsesFetch(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.message !== "fetch failed") return false;

  const cause =
    "cause" in error
      ? String((error as Error & { cause?: unknown }).cause ?? "")
      : "";

  return cause.includes("other side closed") || cause.includes("SocketError");
}

function shouldRetryImageFetch(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  if (error.message !== "fetch failed") return false;

  const cause =
    "cause" in error
      ? String((error as Error & { cause?: unknown }).cause ?? "")
      : "";

  return /other side closed|socketerror|econnreset|etimedout|terminated|network/i.test(cause);
}

function shouldFallbackToImagesApi(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  if (error.message.includes("aborted due to timeout")) return true;
  if (error.message.includes("图片生成超时")) return true;
  if (error.message === "fetch failed") return true;
  return false;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchImagesWithRetry(
  url: string,
  initFactory: () => RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, initFactory());
      if ([408, 429, 502, 503, 504].includes(response.status) && attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!shouldRetryImageFetch(error) || attempt >= 2) {
        throw error;
      }
      await wait(800 * (attempt + 1));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("上游图片接口连接失败"));
}

type ResponsesImagePayload = {
  id?: string;
  status?: string;
  error?: { message?: string };
  output?: Array<{ type?: string; result?: string; b64_json?: string }>;
  type?: string;
  result?: string;
  b64_json?: string;
  image?: string;
  data?: Array<{ b64_json?: string; url?: string }>;
};

type ImagesApiPayload = {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
};

type ImagesApiItem = NonNullable<ImagesApiPayload["data"]>[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStringFromRecord(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseSseDataBlock(block: string) {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") return null;
  return data;
}

function normalizeImageApiPayload(value: unknown): ImagesApiPayload | null {
  if (Array.isArray(value)) return { data: value as ImagesApiPayload["data"] };
  if (isRecord(value)) {
    if (Array.isArray(value.data)) return value as ImagesApiPayload;
    if (getStringFromRecord(value, "b64_json") || getStringFromRecord(value, "url")) {
      return { data: [value as ImagesApiItem] };
    }
  }
  return null;
}

async function readImagesStreamPayload(response: Response): Promise<ImagesApiPayload> {
  if (!response.body) throw new Error("流式图片接口没有返回 body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const completedItems: NonNullable<ImagesApiPayload["data"]> = [];
  let resultPayload: ImagesApiPayload = { data: [] };
  let lastError = "";
  let buffer = "";

  async function processBlock(block: string) {
    const data = parseSseDataBlock(block);
    if (!data) return;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(event)) return;

    const error = event.error;
    if (isRecord(error)) {
      lastError = getStringFromRecord(error, "message") || lastError;
    } else if (typeof error === "string") {
      lastError = error;
    }

    const object = getStringFromRecord(event, "object");
    if (object === "image.generation.result" || object === "image.edit.result") {
      resultPayload = normalizeImageApiPayload(event) ?? resultPayload;
      return;
    }

    const type = getStringFromRecord(event, "type");
    if (type === "image_generation.completed" || type === "image_edit.completed") {
      const item = {
        b64_json: getStringFromRecord(event, "b64_json"),
        url: getStringFromRecord(event, "url"),
        revised_prompt: getStringFromRecord(event, "revised_prompt"),
      };
      if (item.b64_json || item.url) completedItems.push(item);
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.search(/\r?\n\r?\n/);
    while (separator >= 0) {
      const match = buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + match.length);
      await processBlock(block);
      separator = buffer.search(/\r?\n\r?\n/);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) await processBlock(buffer);

  if (resultPayload.data?.length) return resultPayload;
  if (completedItems.length) return { data: completedItems };
  if (lastError) throw new Error(lastError);
  throw new Error("流式接口未返回最终图片数据");
}

function getResponsesImageResult(payload: ResponsesImagePayload) {
  const imageCall = payload.output?.find((item) => item.type === "image_generation_call");
  return (
    imageCall?.result ||
    imageCall?.b64_json ||
    payload.result ||
    payload.b64_json ||
    payload.image ||
    payload.data?.find((item) => item.b64_json)?.b64_json
  );
}

async function readResponsesStreamImageResult(response: Response) {
  if (!response.body) {
    throw new Error("responses 流式接口没有返回 body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let lastImageResult: string | null = null;
  let lastError: string | null = null;

  function consumeEvent(data: string) {
    const trimmed = data.trim();
    if (!trimmed || trimmed === "[DONE]") return;

    try {
      const payload = JSON.parse(trimmed) as ResponsesImagePayload & {
        error?: { message?: string } | string;
        delta?: string;
        item?: ResponsesImagePayload;
      };

      const directResult =
        getResponsesImageResult(payload) ||
        (payload.item ? getResponsesImageResult(payload.item) : null);
      if (directResult) {
        lastImageResult = directResult;
      }

      if (typeof payload.delta === "string" && payload.delta.length > 200) {
        lastImageResult = payload.delta;
      }

      if (payload.error) {
        lastError =
          typeof payload.error === "string"
            ? payload.error
            : payload.error.message || "上游图片流返回错误";
      }
    } catch {
      if (eventName.toLowerCase().includes("error")) {
        lastError = trimmed;
      }
    }
  }

  function drainBuffer(final = false) {
    const parts = buffer.split(/\r?\n/);
    buffer = final ? "" : parts.pop() ?? "";

    for (const line of parts) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        consumeEvent(line.slice("data:".length));
        continue;
      }

      if (line.trim() === "") {
        eventName = "";
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainBuffer();
  }

  buffer += decoder.decode();
  drainBuffer(true);

  if (lastImageResult) return lastImageResult;
  if (lastError) throw new Error(lastError);
  throw new Error("responses 流式接口未返回图片结果");
}

async function fetchResponsesWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RESPONSES_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (
        [502, 503, 504].includes(response.status) &&
        attempt < RESPONSES_RETRY_LIMIT
      ) {
        await wait(1000 * (attempt + 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!shouldRetryResponsesFetch(error) || attempt === RESPONSES_RETRY_LIMIT) {
        throw error;
      }
      await wait(700 * (attempt + 1));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("上游图片接口连接失败"));
}

async function pollResponsesImageResult(input: {
  baseUrl: string;
  apiKey: string;
  responseId: string;
}) {
  const started = Date.now();

  while (Date.now() - started < RESPONSES_POLL_TIMEOUT_MS) {
    await wait(RESPONSES_POLL_INTERVAL_MS);

    const response = await fetchResponsesWithRetry(`${input.baseUrl}/responses/${input.responseId}`, {
      method: "GET",
      signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`图片轮询失败（${response.status}）：${text}`);
    }

    const payload = (await response.json()) as ResponsesImagePayload;
    const result = getResponsesImageResult(payload);
    if (result) return result;

    if (payload.status === "failed" || payload.status === "cancelled") {
      throw new Error(payload.error?.message || `图片生成失败：${payload.status}`);
    }
  }

  throw new Error(`图片生成超时，超过 ${Math.round(RESPONSES_POLL_TIMEOUT_MS / 1000)} 秒仍未完成，请稍后重试`);
}

async function saveBase64Image(base64Data: string, fileName: string) {
  const buffer = Buffer.from(base64Data, "base64");
  return uploadGeneratedBuffer({
    buffer,
    fileName,
  });
}

async function getSourceImageDataUrl(sourceImagePath?: string) {
  if (!sourceImagePath) return null;

  const image = await readReferenceImageBuffer(sourceImagePath);
  if (!image) return null;
  const extension = path.extname(sourceImagePath).toLowerCase();
  const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";

  return `data:${mimeType};base64,${image.toString("base64")}`;
}

async function getSourceImageDataUrls(sourceImagePaths?: string[]) {
  if (!sourceImagePaths?.length) return [];
  const items = await Promise.all(sourceImagePaths.map((item) => getSourceImageDataUrl(item)));
  return items.filter((item): item is string => Boolean(item));
}

async function ensureGeneratedDir() {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
}

export async function saveUploadedReferenceImage(file: File): Promise<UploadedReferenceImage> {
  await ensureGeneratedDir();
  const extension = file.type === "image/jpeg" ? ".jpg" : ".png";
  const fileName = `upload-${Date.now()}-${crypto.randomUUID()}${extension}`;
  const arrayBuffer = await file.arrayBuffer();
  const filePath = await uploadGeneratedBuffer({
    buffer: Buffer.from(arrayBuffer),
    fileName,
  });

  return {
    filePath,
    width: 0,
    height: 0,
  };
}

function buildMockSvg(input: {
  prompt: string;
  style: string;
  size: string;
  quality: string;
  index: number;
}) {
  const { width, height } = getImageDimensions(input.size);
  const safePrompt = input.prompt.slice(0, 84);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#171513"/>
      <stop offset="55%" stop-color="#645648"/>
      <stop offset="100%" stop-color="#E5DACD"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)" />
  <circle cx="${Math.round(width * 0.76)}" cy="${Math.round(height * 0.18)}" r="${Math.round(width * 0.12)}" fill="rgba(255,255,255,.18)" />
  <text x="72" y="96" fill="#FFF9F0" font-size="28" font-family="Georgia, serif">Flux Image</text>
  <text x="72" y="148" fill="#FFF9F0" font-size="58" font-family="Georgia, serif" font-weight="700">生成结果 ${input.index + 1}</text>
  <text x="72" y="218" fill="#F4E9DA" font-size="26" font-family="Arial, sans-serif">${safePrompt}</text>
  <text x="72" y="${height - 98}" fill="#E5D7C7" font-size="22" font-family="Arial, sans-serif">Style: ${input.style}</text>
  <text x="72" y="${height - 62}" fill="#E5D7C7" font-size="22" font-family="Arial, sans-serif">Quality: ${input.quality} / Size: ${input.size}</text>
</svg>`;
}

async function generateMockImages(input: GenerateImageInput): Promise<GeneratedAsset[]> {
  await ensureGeneratedDir();
  const { width, height } = getImageDimensions(input.size);

  return Promise.all(
    Array.from({ length: input.quantity }, async (_, index) => {
      const fileName = `${input.taskId}-${index + 1}.svg`;
      const absolutePath = path.join(GENERATED_DIR, fileName);
      await fs.writeFile(
        absolutePath,
        buildMockSvg({
          prompt: input.prompt,
          style: input.style,
          size: input.size,
          quality: input.quality,
          index,
        }),
        "utf8",
      );

      return {
        filePath: `/generated/${fileName}`,
        width,
        height,
      };
    }),
  );
}

async function generateOpenAiImages(input: GenerateImageInput): Promise<GeneratedAsset[]> {
  const client = getOpenAIClient();
  if (!client) return generateMockImages(input);

  await ensureGeneratedDir();
  const model = getOpenAIModel();
  const wireApi = getOpenAIWireApi();

  if (wireApi === "responses") {
    try {
      return await generateViaResponsesApi(input, model);
    } catch (error) {
      logImageProviderError({
        provider: "openai-compatible-responses",
        baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        model,
        taskId: input.taskId,
        sourceImagePath: input.sourceImagePath,
        wireApi,
        error,
      });
      throw new Error(formatOpenAIError(error, model));
    }
  }

  try {
    const response = await client.images.generate({
      model,
      prompt: buildPrompt(input),
      size: normalizeOpenAISize(input.size, model),
      quality: getOpenAIQuality(model, input.quality),
      n: getOpenAIImageCount(model, input.quantity),
    });

    const items = response.data ?? [];
    if (items.length === 0) throw new Error("图片接口未返回结果");

    const { width, height } = getImageDimensions(input.size);
    const results: GeneratedAsset[] = [];

    for (const [index, item] of items.entries()) {
      const base64Data = item.b64_json;
      const remoteUrl = item.url;
      const fileName = `${input.taskId}-${index + 1}.png`;

      if (base64Data) {
        const filePath = await uploadGeneratedBuffer({
          buffer: Buffer.from(base64Data, "base64"),
          fileName,
        });
        results.push({
          filePath,
          width,
          height,
        });
      } else if (remoteUrl) {
        let fileResp: Response;
        try {
          fileResp = await fetch(remoteUrl);
        } catch (error) {
          throw new Error(
            `下载远程图片失败：${error instanceof Error ? error.message : "未知网络错误"}`,
          );
        }
        if (!fileResp.ok) throw new Error("下载图片结果失败");
        const arrayBuffer = await fileResp.arrayBuffer();
        const filePath = await uploadGeneratedBuffer({
          buffer: Buffer.from(arrayBuffer),
          fileName,
        });
        results.push({
          filePath,
          width,
          height,
        });
      } else {
        throw new Error("图片结果为空");
      }
    }

    return results;
  } catch (error) {
    logImageProviderError({
      provider: "openai-compatible",
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model,
      taskId: input.taskId,
      sourceImagePath: input.sourceImagePath,
      wireApi,
      error,
    });
    throw new Error(formatOpenAIError(error, model));
  }
}

async function generateViaImagesApi(
  input: GenerateImageInput,
  model: string,
  options?: OpenAiRequestOptions,
): Promise<GeneratedAsset[]> {
  const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
  const baseUrl = options?.baseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

  if (!apiKey) {
    return generateMockImages(input);
  }

  const prompt = buildPrompt(input);
  const size = normalizeOpenAISize(input.size, model);
  const quantity = getOpenAIImageCount(model, input.quantity);
  const quality = getOpenAIQuality(model, input.quality);
  const normalizedSourceImagePaths = input.sourceImagePaths?.length
    ? input.sourceImagePaths
    : input.sourceImagePath
      ? [input.sourceImagePath]
      : [];
  const sourceImageDataUrls = await getSourceImageDataUrls(normalizedSourceImagePaths);
  const hasSourceImages = sourceImageDataUrls.length > 0;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_REQUEST_TIMEOUT_MS);

  let response: Response;

  try {
    await appendDirectImageLog("upstream.request", {
      taskId: input.taskId,
      model,
      endpoint: hasSourceImages ? "/v1/images/edits" : "/v1/images/generations",
      size,
      quality,
      timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
      hasSourceImages,
      stream: !hasSourceImages,
      promptLength: prompt.length,
    });

    if (hasSourceImages) {
      const formData = new FormData();
      formData.append("model", model);
      formData.append("prompt", prompt);
      formData.append("size", size);
      formData.append("quality", quality);
      formData.append("output_format", "png");
      formData.append("moderation", "auto");
      if (quantity > 1) {
        formData.append("n", String(quantity));
      }

      for (const [index, dataUrl] of sourceImageDataUrls.entries()) {
        const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (!match) continue;
        const mimeType = match[1] || "image/png";
        const extension = mimeType === "image/jpeg" ? "jpg" : "png";
        const bytes = Buffer.from(match[2], "base64");
        const blob = new Blob([bytes], { type: mimeType });
        formData.append("image", blob, `input-${index + 1}.${extension}`);
        formData.append("image[]", blob, `input-${index + 1}.${extension}`);
      }

      response = await fetchImagesWithRetry(`${baseUrl}/images/edits`, () => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        cache: "no-store",
        signal: controller.signal,
      }));
    } else {
      const requestBody = JSON.stringify({
        model,
        prompt,
        size,
        quality,
        output_format: "png",
        moderation: "auto",
        ...(quantity > 1 ? { n: quantity } : {}),
        stream: true,
        partial_images: 2,
      });

      response = await fetchImagesWithRetry(`${baseUrl}/images/generations`, () => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        cache: "no-store",
        signal: controller.signal,
      }));
    }

    await appendDirectImageLog("upstream.response", {
      taskId: input.taskId,
      status: response.status,
      ok: response.ok,
    });

    if (!response.ok) {
      const rawPayload = await response.text();
      const error = new Error(
        rawPayload || `图片接口调用失败（${response.status}）`,
      ) as Error & { status?: number; rawPayload?: string };
      error.name = response.status === 403 ? "UpstreamForbiddenError" : "UpstreamImageError";
      error.status = response.status;
      error.rawPayload = rawPayload;
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      await appendDirectImageLog("upstream.timeout", {
        taskId: input.taskId,
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
      });
      throw new Error(
        `图片生成超时，超过 ${Math.round(OPENAI_REQUEST_TIMEOUT_MS / 1000)} 秒仍未完成`,
      );
    }
    await appendDirectImageLog("upstream.error", {
      taskId: input.taskId,
      error: error instanceof Error ? error.message : String(error),
      cause:
        error instanceof Error && "cause" in error
          ? String((error as Error & { cause?: unknown }).cause ?? "")
          : "",
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const isEventStream = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream");
  let payload: ImagesApiPayload;

  try {
    payload = isEventStream
      ? await readImagesStreamPayload(response)
      : ((await response.json()) as ImagesApiPayload);
  } catch (streamError) {
    if (!hasSourceImages && isEventStream) {
      await appendDirectImageLog("upstream.parse_error", {
        taskId: input.taskId,
        mode: "stream",
        error: streamError instanceof Error ? streamError.message : String(streamError),
      });

      const fallbackBody = JSON.stringify({
        model,
        prompt,
        size,
        quality,
        output_format: "png",
        moderation: "auto",
        ...(quantity > 1 ? { n: quantity } : {}),
        stream: false,
      });
      const fallbackResponse = await fetchImagesWithRetry(`${baseUrl}/images/generations`, () => ({
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: fallbackBody,
        cache: "no-store",
        signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
      }));

      await appendDirectImageLog("upstream.fallback_response", {
        taskId: input.taskId,
        status: fallbackResponse.status,
        ok: fallbackResponse.ok,
      });

      if (!fallbackResponse.ok) {
        const rawPayload = await fallbackResponse.text();
        throw new Error(rawPayload || `图片接口回退调用失败（${fallbackResponse.status}）`);
      }

      payload = (await fallbackResponse.json()) as ImagesApiPayload;
    } else {
      throw streamError;
    }
  }

  const items = payload.data ?? [];
  await appendDirectImageLog("upstream.parsed", {
    taskId: input.taskId,
    itemCount: items.length,
    hasBase64: items.some((item) => Boolean(item.b64_json)),
    hasUrl: items.some((item) => Boolean(item.url)),
  });
  if (items.length === 0) throw new Error("图片接口未返回结果");

  const { width, height } = getImageDimensions(input.size);
  const results: GeneratedAsset[] = [];

  for (const [index, item] of items.entries()) {
    const base64Data = item.b64_json;
    const remoteUrl = item.url;
    const fileName = `${input.taskId}-${index + 1}.png`;

    if (base64Data) {
      const filePath = await uploadGeneratedBuffer({
        buffer: Buffer.from(base64Data, "base64"),
        fileName,
      });
      results.push({
        filePath,
        width,
        height,
      });
    } else if (remoteUrl) {
      let fileResp: Response;
      try {
        fileResp = await fetch(remoteUrl);
      } catch (error) {
        throw new Error(
          `下载远程图片失败：${error instanceof Error ? error.message : "未知网络错误"}`,
        );
      }
      if (!fileResp.ok) throw new Error("下载图片结果失败");
      const arrayBuffer = await fileResp.arrayBuffer();
      const filePath = await uploadGeneratedBuffer({
        buffer: Buffer.from(arrayBuffer),
        fileName,
      });
      results.push({
        filePath,
        width,
        height,
      });
    } else {
      throw new Error("图片结果为空");
    }
  }

  return results;
}

async function generateOpenAiImagesWithOptions(
  input: GenerateImageInput,
  options: ImageClientOptions,
): Promise<GeneratedAsset[]> {
  await ensureGeneratedDir();
  const model = options.model || "gpt-image-2";
  const hasSourceImages = Boolean(
    (input.sourceImagePaths && input.sourceImagePaths.length > 0) || input.sourceImagePath,
  );
  const wireApi = hasSourceImages ? "responses" : options.wireApi || "images";

  if (wireApi === "responses") {
    try {
      return await generateViaResponsesApi(input, model, {
        apiKey: options.apiKey,
        baseURL: options.baseURL,
      });
    } catch (error) {
      logImageProviderError({
        provider: "openai-compatible-responses",
        baseURL: options.baseURL || "https://api.openai.com/v1",
        model,
        taskId: input.taskId,
        sourceImagePath: input.sourceImagePath,
        wireApi,
        error,
      });
      throw new Error(formatOpenAIError(error, model));
    }
  }

  try {
    return await generateViaImagesApi(input, model, {
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
  } catch (error) {
    logImageProviderError({
      provider: "openai-compatible",
      baseURL: options.baseURL || "https://api.openai.com/v1",
      model,
      taskId: input.taskId,
      sourceImagePath: input.sourceImagePath,
      wireApi,
      error,
    });
    throw new Error(formatOpenAIError(error, model));
  }
}

async function generateViaResponsesApi(
  input: GenerateImageInput,
  model: string,
  options?: { apiKey?: string; baseURL?: string },
): Promise<GeneratedAsset[]> {
  const baseUrl = options?.baseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("未配置 OPENAI_API_KEY");
  }

  const { width, height } = getImageDimensions(input.size);
  const results: GeneratedAsset[] = [];
  const count = Math.max(1, input.quantity);
  const normalizedSourceImagePaths = input.sourceImagePaths?.length
    ? input.sourceImagePaths
    : input.sourceImagePath
      ? [input.sourceImagePath]
      : [];
  const sourceImageDataUrls = await getSourceImageDataUrls(normalizedSourceImagePaths);
  const hasSourceImages = sourceImageDataUrls.length > 0;
  const content = hasSourceImages
    ? [
        { type: "input_text", text: buildPrompt(input) },
        ...sourceImageDataUrls.map((imageUrl) => ({
          type: "input_image" as const,
          image_url: imageUrl,
        })),
      ]
    : buildPrompt(input);

  for (let index = 0; index < count; index += 1) {
    const requestBody = {
      model,
      stream: true,
      input: hasSourceImages
        ? [
            {
              role: "user",
              content,
            },
          ]
        : content,
      tools: [
        {
          type: "image_generation",
          model: "gpt-image-2.0",
          action: hasSourceImages ? "edit" : "generate",
          quality: getResponsesImageQuality(input.quality),
          size: normalizeOpenAISize(input.size, "gpt-image-2.0"),
          background: input.background || "auto",
          output_format: "png",
        },
      ],
      tool_choice: {
        type: "image_generation",
      },
    };

    await appendDirectImageLog("upstream.request", {
      taskId: input.taskId,
      model,
      endpoint: "/v1/responses",
      size: normalizeOpenAISize(input.size, "gpt-image-2.0"),
      quality: getResponsesImageQuality(input.quality),
      timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
      hasSourceImages,
      stream: true,
      promptLength: buildPrompt(input).length,
    });

    let response: Response;
    try {
      response = await fetchResponsesWithRetry(`${baseUrl}/responses`, {
        method: "POST",
        signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      await appendDirectImageLog("upstream.error", {
        taskId: input.taskId,
        error: error instanceof Error ? error.message : String(error),
        cause:
          error instanceof Error && "cause" in error
            ? String((error as Error & { cause?: unknown }).cause ?? "")
            : "",
      });
      throw error;
    }

    await appendDirectImageLog("upstream.response", {
      taskId: input.taskId,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type") || "",
    });

    if (!response.ok) {
      const text = await response.text();
      await appendDirectImageLog("upstream.error", {
        taskId: input.taskId,
        error: `图片接口调用失败（${response.status}）：${text}`,
      });
      throw new Error(`图片接口调用失败（${response.status}）：${text}`);
    }

    const isEventStream = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream");
    let result: string | null = null;

    if (isEventStream) {
      result = await readResponsesStreamImageResult(response);
    } else {
      const payload = (await response.json()) as ResponsesImagePayload;
      result =
        getResponsesImageResult(payload) ||
        (payload.id
          ? await pollResponsesImageResult({
              baseUrl,
              apiKey,
              responseId: payload.id,
            })
          : null);
    }

    if (!result) {
      throw new Error("responses 接口未返回图片结果");
    }

    const fileName = `${input.taskId}-${index + 1}.png`;
    const filePath = await saveBase64Image(result, fileName);
    await appendDirectImageLog("upstream.parsed", {
      taskId: input.taskId,
      itemCount: 1,
      hasBase64: true,
      hasUrl: false,
      wireApi: "responses",
    });
    results.push({
      filePath,
      width,
      height,
    });
  }

  return results;
}

async function generateRemoteImages(input: GenerateImageInput): Promise<GeneratedAsset[]> {
  const endpoint = process.env.IMAGE_API_URL;
  if (!endpoint) return generateMockImages(input);

  await ensureGeneratedDir();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.IMAGE_API_KEY
        ? { Authorization: `Bearer ${process.env.IMAGE_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      prompt: input.prompt,
      style: input.style,
      size: input.size,
      quality: input.quality,
      quantity: input.quantity,
    }),
  });

  if (!response.ok) throw new Error(`图片接口调用失败: ${response.status}`);

  const payload = (await response.json()) as {
    images?: Array<{ url?: string; base64?: string }>;
    image_urls?: string[];
  };

  const items =
    payload.images?.map((item) => item.url ?? item.base64 ?? "") ??
    payload.image_urls?.map((url) => url) ??
    [];

  if (items.length === 0) throw new Error("图片接口未返回结果");

  const { width, height } = getImageDimensions(input.size);
  const results: GeneratedAsset[] = [];

  for (const [index, item] of items.entries()) {
    const fileName = `${input.taskId}-${index + 1}.png`;

    if (item.startsWith("http")) {
      let fileResp: Response;
      try {
        fileResp = await fetch(item);
      } catch (error) {
        throw new Error(
          `下载远程图片失败：${error instanceof Error ? error.message : "未知网络错误"}`,
        );
      }
      if (!fileResp.ok) throw new Error("下载远程图片失败");
      const arrayBuffer = await fileResp.arrayBuffer();
      const filePath = await uploadGeneratedBuffer({
        buffer: Buffer.from(arrayBuffer),
        fileName,
      });
      results.push({
        filePath,
        width,
        height,
      });
    } else {
      const base64Data = item.includes(",") ? item.split(",")[1]! : item;
      const filePath = await uploadGeneratedBuffer({
        buffer: Buffer.from(base64Data, "base64"),
        fileName,
      });
      results.push({
        filePath,
        width,
        height,
      });
    }
  }

  return results;
}

export async function generateImages(input: GenerateImageInput) {
  if (!process.env.OPENAI_API_KEY) {
    if (process.env.IMAGE_API_URL) {
      return generateRemoteImages(input);
    }
    return generateMockImages(input);
  }

  return generateViaImagesApi(input, getOpenAIModel(), {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

export async function generateImagesWithUserConfig(
  input: Omit<GenerateImageInput, "taskId" | "style" | "quality"> & {
    style?: string;
    quality?: string;
    background?: "auto" | "opaque" | "transparent";
  },
  options: ImageClientOptions,
) {
  const taskId = `direct-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const normalizedInput: GenerateImageInput = {
    ...input,
    taskId,
    style: input.style || "自由创作",
    quality: input.quality || "高细节质量",
    background: input.background || "auto",
  };

  return generateOpenAiImagesWithOptions(normalizedInput, {
    ...options,
    model: options.model || getFallbackImageModel(),
  });
}
