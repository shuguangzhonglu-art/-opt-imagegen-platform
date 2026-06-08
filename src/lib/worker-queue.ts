import { Worker } from "bullmq";

import {
  DIRECT_GENERATE_QUEUE,
  getRedisConnectionOptions,
  type DirectGenerateJobData,
} from "@/lib/queue";

export function createDirectGenerateWorker(
  processor: (data: DirectGenerateJobData) => Promise<void>,
) {
  const concurrency = Number(process.env.DIRECT_WORKER_CONCURRENCY ?? process.env.GLOBAL_WORKER_CONCURRENCY ?? 10);
  return new Worker<DirectGenerateJobData>(
    DIRECT_GENERATE_QUEUE,
    async (job) => {
      await processor(job.data);
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency,
      autorun: true,
    },
  );
}
