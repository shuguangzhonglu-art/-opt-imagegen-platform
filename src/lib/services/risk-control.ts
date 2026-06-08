import type { ModerationMode, ModerationResult } from "@prisma/client";

import { prisma } from "@/lib/db";

export type KeywordStrategy = "KEYWORD_AND_API" | "KEYWORD_ONLY" | "API_ONLY";

export type RiskControlConfig = {
  enabled: boolean;
  mode: ModerationMode;
  baseUrl: string;
  model: string;
  apiKeys: string[];
  timeoutMs: number;
  retryCount: number;
  sampleRate: number;
  keywordStrategy: KeywordStrategy;
  blockedKeywords: string[];
  retentionDays: number;
  notifyOnHit: boolean;
  blockMessage: string;
};

export type RiskControlStatus = {
  config: RiskControlConfig;
  totalLogs: number;
  syncProcessing: number;
  checked: number;
  passed: number;
  blocked: number;
  errors: number;
  avgLatencyMs: number;
  apiKeyCount: number;
  workerCount: number;
  activeWorkers: number;
  availableKeys: number;
};

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_MODEL = "omni-moderation-latest";
const DEFAULT_BLOCK_MESSAGE = "内容审计命中风险规则，请调整输入后重试";

function splitLines(value: string | null | undefined) {
  return String(value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeKeywordStrategy(value: string): KeywordStrategy {
  if (value === "KEYWORD_ONLY" || value === "API_ONLY") return value;
  return "KEYWORD_AND_API";
}

function summarizeInput(input: string) {
  const compact = input.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

async function ensureSettings() {
  return prisma.appSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultUnitCost: 40,
      availableSizes: "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80",
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
    },
  });
}

export async function getRiskControlConfig(): Promise<RiskControlConfig> {
  const settings = await ensureSettings();
  return {
    enabled: settings.contentModerationEnabled,
    mode: settings.moderationMode,
    baseUrl: settings.moderationBaseUrl || DEFAULT_BASE_URL,
    model: settings.moderationModel || DEFAULT_MODEL,
    apiKeys: splitLines(settings.moderationApiKeys),
    timeoutMs: settings.moderationTimeoutMs,
    retryCount: settings.moderationRetryCount,
    sampleRate: settings.moderationSampleRate,
    keywordStrategy: normalizeKeywordStrategy(settings.moderationKeywordStrategy),
    blockedKeywords: splitLines(settings.moderationBlockedKeywords),
    retentionDays: settings.moderationRetentionDays,
    notifyOnHit: settings.moderationNotifyOnHit,
    blockMessage: settings.moderationBlockMessage || DEFAULT_BLOCK_MESSAGE,
  };
}

export async function saveRiskControlConfig(input: RiskControlConfig) {
  const settings = await ensureSettings();
  const existingKeys = splitLines(settings.moderationApiKeys);
  const nextKeys = Array.from(new Set([...existingKeys, ...input.apiKeys]));
  const nextKeywords = Array.from(
    new Set(input.blockedKeywords.map((item) => item.trim()).filter((item) => item.length > 0 && item.length <= 200)),
  ).slice(0, 10000);

  await prisma.appSetting.update({
    where: { id: 1 },
    data: {
      contentModerationEnabled: input.enabled,
      moderationMode: input.mode,
      moderationBaseUrl: input.baseUrl,
      moderationModel: input.model,
      moderationApiKeys: nextKeys.join("\n"),
      moderationTimeoutMs: input.timeoutMs,
      moderationRetryCount: input.retryCount,
      moderationSampleRate: input.sampleRate,
      moderationKeywordStrategy: input.keywordStrategy,
      moderationBlockedKeywords: nextKeywords.join("\n"),
      moderationRetentionDays: input.retentionDays,
      moderationNotifyOnHit: input.notifyOnHit,
      moderationBlockMessage: input.blockMessage,
    },
  });
}

export async function getRiskControlStatus(): Promise<RiskControlStatus> {
  const config = await getRiskControlConfig();
  const [totalLogs, blocked, errors, passed, avg] = await Promise.all([
    prisma.contentModerationLog.count(),
    prisma.contentModerationLog.count({ where: { result: "BLOCKED" } }),
    prisma.contentModerationLog.count({ where: { result: "ERROR" } }),
    prisma.contentModerationLog.count({ where: { result: { in: ["PASSED", "SAMPLED"] } } }),
    prisma.contentModerationLog.aggregate({ _avg: { latencyMs: true } }),
  ]);

  return {
    config,
    totalLogs,
    syncProcessing: 0,
    checked: totalLogs,
    passed,
    blocked,
    errors,
    avgLatencyMs: Math.round(avg._avg.latencyMs ?? 0),
    apiKeyCount: config.apiKeys.length,
    workerCount: 4,
    activeWorkers: 0,
    availableKeys: config.apiKeys.length,
  };
}

export async function getRiskControlLogs(options?: {
  result?: ModerationResult | "ALL";
  endpoint?: string;
  search?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  return prisma.contentModerationLog.findMany({
    where: {
      result: options?.result && options.result !== "ALL" ? options.result : undefined,
      endpoint: options?.endpoint && options.endpoint !== "ALL" ? options.endpoint : undefined,
      createdAt: {
        gte: options?.from,
        lte: options?.to,
      },
      OR: options?.search
        ? [
            { userEmail: { contains: options.search, mode: "insensitive" } },
            { inputSummary: { contains: options.search, mode: "insensitive" } },
            { apiKeyTail: { contains: options.search, mode: "insensitive" } },
          ]
        : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 80,
  });
}

function keyTail(key: string) {
  return key.length > 8 ? `...${key.slice(-6)}` : "";
}

function highestModerationScore(result: ModerationAPIResult) {
  const scores = result.category_scores ?? {};
  return Object.entries(scores).reduce(
    (highest, [category, score]) => {
      const numeric = Number(score);
      return numeric > highest.score ? { category, score: numeric } : highest;
    },
    { category: "", score: 0 },
  );
}

async function callOpenAIModeration(config: RiskControlConfig, prompt: string) {
  let lastError: Error | undefined;
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/v1/moderations`;
  const attempts = Math.max(1, config.retryCount + 1);

  for (let index = 0; index < attempts; index += 1) {
    const key = config.apiKeys[index % config.apiKeys.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: config.model,
          input: prompt,
        }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`moderation api status ${response.status}: ${text.slice(0, 300)}`);
      }

      const parsed = JSON.parse(text) as ModerationAPIResponse;
      const result = parsed.results?.[0];
      if (!result) throw new Error("moderation api returned empty results");
      return { result, keyTail: keyTail(key) };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error("moderation api failed");
}

export async function checkContentModeration(input: {
  userId?: string;
  userEmail?: string;
  endpoint: string;
  prompt: string;
  apiKeyTail?: string;
  model?: string;
}) {
  const config = await getRiskControlConfig();
  if (!config.enabled || config.mode === "OFF") return;

  const started = Date.now();
  const normalized = input.prompt.toLowerCase();
  const canUseKeyword = config.keywordStrategy !== "API_ONLY";
  const canUseAPI = config.keywordStrategy !== "KEYWORD_ONLY";
  const hit = canUseKeyword
    ? config.blockedKeywords.find((keyword) => normalized.includes(keyword.toLowerCase()))
    : undefined;

  if (hit) {
    await prisma.contentModerationLog.create({
      data: {
        userId: input.userId,
        userEmail: input.userEmail,
        apiKeyTail: input.apiKeyTail,
        endpoint: input.endpoint,
        model: input.model || config.model,
        result: "BLOCKED",
        action: hit && config.mode === "PRE_BLOCK" ? "拒绝请求" : "放行记录",
        highestCategory: hit ? "keyword" : undefined,
        highestScore: hit ? 1 : 0,
        inputSummary: summarizeInput(input.prompt),
        latencyMs: Date.now() - started,
        violationCount: hit ? 1 : 0,
      },
    });

    if (config.mode === "PRE_BLOCK") {
      throw new Error(config.blockMessage);
    }
    return;
  }

  const shouldSample = Math.random() * 100 < config.sampleRate;
  if (!canUseAPI) {
    if (shouldSample || config.mode === "OBSERVE") {
      await prisma.contentModerationLog.create({
        data: {
          userId: input.userId,
          userEmail: input.userEmail,
          endpoint: input.endpoint,
          model: input.model || config.model,
          result: shouldSample ? "SAMPLED" : "PASSED",
          action: "放行记录",
          inputSummary: summarizeInput(input.prompt),
          latencyMs: Date.now() - started,
        },
      });
    }
    return;
  }

  if (config.apiKeys.length === 0) {
    await prisma.contentModerationLog.create({
      data: {
        userId: input.userId,
        userEmail: input.userEmail,
        endpoint: input.endpoint,
        model: input.model || config.model,
        result: "ERROR",
        action: "审核异常",
        inputSummary: summarizeInput(input.prompt),
        latencyMs: Date.now() - started,
        errorMessage: "未配置 OpenAI moderation API Key",
      },
    });
    return;
  }

  try {
    const moderation = await callOpenAIModeration(config, input.prompt);
    const highest = highestModerationScore(moderation.result);
    const blocked = Boolean(moderation.result.flagged);

    await prisma.contentModerationLog.create({
      data: {
        userId: input.userId,
        userEmail: input.userEmail,
        apiKeyTail: moderation.keyTail,
        endpoint: input.endpoint,
        model: input.model || config.model,
        result: blocked ? "BLOCKED" : shouldSample ? "SAMPLED" : "PASSED",
        action: blocked && config.mode === "PRE_BLOCK" ? "拒绝请求" : "放行记录",
        highestCategory: highest.category || undefined,
        highestScore: highest.score,
        inputSummary: summarizeInput(input.prompt),
        latencyMs: Date.now() - started,
        violationCount: blocked ? 1 : 0,
      },
    });

    if (blocked && config.mode === "PRE_BLOCK") {
      throw new Error(config.blockMessage);
    }
  } catch (error) {
    if (error instanceof Error && error.message === config.blockMessage) {
      throw error;
    }

    await prisma.contentModerationLog.create({
      data: {
        userId: input.userId,
        userEmail: input.userEmail,
        endpoint: input.endpoint,
        model: input.model || config.model,
        result: "ERROR",
        action: "审核异常",
        inputSummary: summarizeInput(input.prompt),
        latencyMs: Date.now() - started,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

type ModerationAPIResponse = {
  results?: ModerationAPIResult[];
};

type ModerationAPIResult = {
  flagged?: boolean;
  category_scores?: Record<string, number>;
};
