module.exports = {
  apps: [
    {
      name: "imagegen-platform",
      script: "npm",
      args: "run start -- -p 3000",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "650M",
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "imagegen-worker",
      script: "npm",
      args: "run worker:direct",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "1200M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
