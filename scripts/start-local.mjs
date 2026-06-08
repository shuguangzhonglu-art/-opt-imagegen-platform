import { spawn } from "node:child_process";

const port = process.env.PORT ?? "4320";

const children = [
  spawn("npm", ["run", "start", "--", "-p", port], {
    stdio: "inherit",
    env: { ...process.env, PORT: port },
  }),
  spawn("npm", ["run", "worker:direct"], {
    stdio: "inherit",
    env: process.env,
  }),
];

function stopAll(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      stopAll(signal ?? "SIGTERM");
      process.exit(code);
    }
  });
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  process.exit(143);
});
