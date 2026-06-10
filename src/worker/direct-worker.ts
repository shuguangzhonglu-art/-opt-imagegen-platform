import { ensureRuntimeSetup } from "@/lib/bootstrap";
import { createDirectGenerateWorker } from "@/lib/worker-queue";
import { processDirectGenerateTaskById, recoverStaleDirectTasks } from "@/lib/services/direct-tasks";

const STALE_RECOVERY_INTERVAL_MS = Number(process.env.DIRECT_STALE_RECOVERY_INTERVAL_MS ?? 60 * 1000);

async function recoverAndLogStaleTasks(reason: string) {
  const recovered = await recoverStaleDirectTasks();
  if (recovered) {
    console.log(`Recovered ${recovered} running direct task(s) during ${reason}`);
  }
}

async function main() {
  await ensureRuntimeSetup();
  await recoverAndLogStaleTasks("startup");

  const worker = createDirectGenerateWorker(async ({ taskId }) => {
    await processDirectGenerateTaskById(taskId);
  });

  const staleRecoveryTimer = setInterval(() => {
    recoverAndLogStaleTasks("scheduled recovery").catch((error) => {
      console.error("stale direct task recovery failed", error);
    });
  }, STALE_RECOVERY_INTERVAL_MS);
  staleRecoveryTimer.unref?.();

  worker.on("completed", (job) => {
    console.log(`direct task completed: ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`direct task failed: ${job?.id ?? "unknown"}`, error);
  });

  console.log(`Direct worker started. concurrency=${process.env.DIRECT_WORKER_CONCURRENCY ?? process.env.GLOBAL_WORKER_CONCURRENCY ?? 10}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
