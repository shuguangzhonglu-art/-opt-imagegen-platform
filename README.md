# HEMA API Image

图片生成运营站。

当前架构：

- Next.js Web：登录、画布、后台、兑换券
- Postgres：用户、钱包、积分流水、任务、图片记录
- Redis/BullMQ：生成任务队列
- 独立 Worker：调用上游图片 API，写入结果
- R2/Object Storage：推荐保存生成图片

## 本地开发

需要本地 Postgres 和 Redis。

```bash
npm install
npx prisma generate
npx prisma db push
npm run build
```

启动本地完整服务：

```bash
npm run start:local
```

如果只启动 Web，生成任务会进入队列但不会被消费，页面会一直显示生成中。也可以手动拆成两条命令：

```bash
PORT=4320 npm run start
npm run worker:direct
```

访问：

```text
http://127.0.0.1:4320
```

默认管理员：

```text
admin@flux.local
admin123456
```

## 环境变量

参考：

```text
.env.example
deploy/production.env.example
```

关键项：

```env
DATABASE_URL="postgresql://imagegen:imagegen@127.0.0.1:5432/imagegen"
REDIS_URL="redis://127.0.0.1:6379"
DIRECT_WORKER_CONCURRENCY="10"
USER_PENDING_LIMIT="20"
OPENAI_BASE_URL="https://hemasir.online/v1"
```

## 部署

看：

```text
deploy/DEPLOY.md
```

## 验证

```bash
npm run build
redis-cli ping
psql "$DATABASE_URL" -c 'select count(*) from "User";'
```
