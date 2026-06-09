import fs from "node:fs/promises";
import path from "node:path";

import { UserRole, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { processNextPendingTask, recoverStaleRunningTasks } from "@/lib/services/tasks";

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");
const DEFAULT_SIZES = "1024x1024:40,1024x1536:60,1536x1024:60,1024x1792:80,1792x1024:80";
const LEGACY_DEFAULT_SIZES = "1024x1024:40,1536x1024:60,2048x2048:80";
const RESPONSES_DEFAULT_SIZES = "1024x1024:40,1536x1024:60,1024x1536:60";

declare global {
  var __workerStarted: boolean | undefined;
  var __bootstrapStarted: boolean | undefined;
}

export async function ensureRuntimeSetup() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (global.__bootstrapStarted) return;
  global.__bootstrapStarted = true;

  await fs.mkdir(GENERATED_DIR, { recursive: true });

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      defaultUnitCost: 40,
      availableSizes: DEFAULT_SIZES,
      taskConcurrency: 1,
      fileRetentionDays: 30,
      signupBonus: 200,
      emailVerificationEnabled: true,
      smtpHost: "",
      smtpPort: 587,
      smtpUser: "",
      smtpPassword: "",
      smtpFrom: "",
      turnstileEnabled: false,
      turnstileSiteKey: "",
      turnstileSecretKey: "",
      registerRateLimitEnabled: true,
      registerRateLimitWindowMinutes: 60,
      registerRateLimitMax: 5,
    },
  });

  const settings = await prisma.appSetting.findUnique({ where: { id: 1 } });
  if (settings?.availableSizes === LEGACY_DEFAULT_SIZES || settings?.availableSizes === RESPONSES_DEFAULT_SIZES) {
    await prisma.appSetting.update({
      where: { id: 1 },
      data: { availableSizes: DEFAULT_SIZES },
    });
  }

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@flux.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123456";
  const adminHash = await hashPassword(adminPassword);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
    create: {
      email: adminEmail,
      passwordHash: adminHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      wallet: { create: { balance: 0 } },
    },
  });

  await prisma.user.updateMany({
    where: {
      emailVerifiedAt: null,
      createdAt: { lt: new Date(Date.now() - 1000 * 60) },
    },
    data: {
      emailVerifiedAt: new Date(),
    },
  });
}

export function startTaskWorker() {
  if (global.__workerStarted) return;
  global.__workerStarted = true;

  const intervalMs = Number(process.env.TASK_POLL_MS ?? 4000);
  void recoverStaleRunningTasks().catch((error) => {
    console.error("task-recovery", error);
  });

  setInterval(async () => {
    try {
      await processNextPendingTask();
    } catch (error) {
      console.error("task-worker", error);
    }
  }, intervalMs).unref();
}
