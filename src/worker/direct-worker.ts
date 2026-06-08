import { ensureRuntimeSetup } from "@/lib/bootstrap";
import { createDirectGenerateWorker } from "@/lib/worker-queue";
import { processDirectGenerateTaskById, recoverStaleDirectTasks } from "@/lib/services/direct-tasks";

async function main() {
  await ensureRuntimeSetup();
  const recovered = await recoverStaleDirectTasks();
  if (recovered) {
    console.log(`Recovered ${recovered} running direct task(s)`);
  }

  const worker = createDirectGenerateWorker(async ({ taskId }) => {
    await processDirectGenerateTaskById(taskId);
  });

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
