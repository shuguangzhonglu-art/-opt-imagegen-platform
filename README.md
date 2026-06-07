# HEMA API Image

极简 BYOK 图片生成站。

当前项目只保留：

- 用户自己填写 API Key
- 文生图
- 多参考图上传
- 流式 `gpt-image-2` 生成
- 本地图片保存
- 按用户 API Key 哈希读取历史图片

当前项目不包含：

- 登录系统
- 积分系统
- 兑换码
- 管理后台
- 用户中心
- SaaS 任务队列后台

## 本地开发

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

访问：

```text
http://localhost:3000
http://localhost:3000/new-home
```

## 环境变量

```env
DATABASE_URL="file:/private/tmp/imagegen-platform-dev.db"

OPENAI_API_KEY=""
OPENAI_BASE_URL="https://hemasir.online/v1"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_FALLBACK_IMAGE_MODEL="gpt-image-2"
OPENAI_WIRE_API="images"
OPENAI_REQUEST_TIMEOUT_MS="300000"
OPENAI_RESPONSES_POLL_TIMEOUT_MS="300000"
```

`OPENAI_API_KEY` 默认留空。用户在页面里填写自己的 Key。

## 部署

部署文档：

```text
deploy/DEPLOY.md
```

快速启动：

```bash
cp deploy/production.env.example .env
mkdir -p data public/generated
docker compose up -d --build
```

## 日志

业务日志：

```bash
tail -f public/generated/logs/direct-image.log
```

容器日志：

```bash
docker logs -f imagegen-platform
```

## 构建检查

```bash
npm run build
```
