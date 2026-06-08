import { Queue, type JobsOptions } from "bullmq";

export const DIRECT_GENERATE_QUEUE = "direct-generate";

declare global {
  var __imagegenDirectQueue: Queue | undefined;
}

export type DirectGenerateJobData = {
  taskId: string;
};

function getRedisUrl() {
  return process.env.REDIS_URL || "redis://127.0.0.1:6379";
}

export function getRedisConnectionOptions() {
  return {
    url: getRedisUrl(),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function getDirectGenerateQueue() {
  if (!global.__imagegenDirectQueue) {
    global.__imagegenDirectQueue = new Queue<DirectGenerateJobData>(DIRECT_GENERATE_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: Number(process.env.DIRECT_JOB_ATTEMPTS ?? 1),
        removeOnComplete: { age: 60 * 60, count: 1000 },
        removeOnFail: { age: 24 * 60 * 60, count: 2000 },
      },
    });
  }

  return global.__imagegenDirectQueue;
}

export async function enqueueDirectGenerateTask(taskId: string, options?: JobsOptions) {
  const queue = getDirectGenerateQueue();
  return queue.add(
    "generate",
    { taskId },
    {
      jobId: taskId,
      ...options,
    },
  );
}
