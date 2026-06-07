# HEMA API Image 部署指南

这份文档按你现在这台服务器的真实情况来写：

- 服务器：`Ubuntu 24.04`
- 规格：`1C / 961MiB RAM / 1GiB Swap`
- 当前主服务已经在跑：`sub2api + postgres + redis + nginx`
- 目标：把当前图片项目挂上去，但不要明显增加内存压力，也不要干扰现有 `sub2api`

结论先说：

- 不建议再单独起一套完整 Docker 应用栈
- 最适合的是：`Next standalone + systemd + 挂到现有 nginx`
- 图片建议继续走 `Cloudflare R2`
- SQLite 可以保留，不需要再加新数据库

## 1. 推荐部署结构

服务器上最终结构建议这样：

```text
/opt/imagegen-platform
  ├── server.js
  ├── .env
  ├── .next/
  ├── public/
  ├── prisma/
  └── data/
```

运行方式：

- Node 直接跑 `server.js`
- 监听本地端口 `4320`
- Nginx 反代到 `127.0.0.1:4320`

这样比再起一个 Docker 容器更省内存，也更适合你这台机器。

## 2. 本地打包

在你本机项目目录执行：

```bash
cd /Users/hemasir/Documents/图片生成网站项目/imagegen-platform
chmod +x deploy/build-standalone.sh
./deploy/build-standalone.sh
```

打完以后会生成：

```text
imagegen-platform-standalone.tar.gz
```

## 3. 上传到服务器

上传：

```bash
scp -P 2222 imagegen-platform-standalone.tar.gz root@23.94.68.252:/opt/
```

登录服务器：

```bash
ssh rack
```

解压：

```bash
mkdir -p /opt/imagegen-platform
tar -xzf /opt/imagegen-platform-standalone.tar.gz -C /opt/imagegen-platform
mkdir -p /opt/imagegen-platform/data
mkdir -p /opt/imagegen-platform/public/generated
```

## 4. 服务器环境变量

编辑：

```bash
nano /opt/imagegen-platform/.env
```

推荐内容：

```env
DATABASE_URL="file:/opt/imagegen-platform/data/prod.db"

TASK_POLL_MS="4000"

OPENAI_API_KEY=""
OPENAI_BASE_URL="https://hemasir.online/v1"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_FALLBACK_IMAGE_MODEL="gpt-image-2"
OPENAI_WIRE_API="images"
OPENAI_REQUEST_TIMEOUT_MS="300000"
OPENAI_RESPONSES_POLL_TIMEOUT_MS="300000"

IMAGE_API_URL=""
IMAGE_API_KEY=""

OBJECT_STORAGE_ENDPOINT="https://f848d2bf47e42faebac150a6baa53ec0.r2.cloudflarestorage.com"
OBJECT_STORAGE_REGION="auto"
OBJECT_STORAGE_BUCKET="hema-api-images"
OBJECT_STORAGE_ACCESS_KEY_ID="你的 R2 Access Key"
OBJECT_STORAGE_SECRET_ACCESS_KEY="你的 R2 Secret"
OBJECT_STORAGE_PUBLIC_BASE_URL="https://cdn.hemasir.online"
```

关键点：

- `OPENAI_API_KEY=""` 必须留空
- 前端用户自己填 Key
- 图片走 `gpt-image-2`
- 有 R2 就别再把最终图压在本机

## 5. 初始化数据库

这项目现在用 SQLite。

第一次在服务器执行：

```bash
cd /opt/imagegen-platform
npx prisma db push
```

如果提示 `npx` 太慢，也可以直接：

```bash
./node_modules/.bin/prisma db push
```

## 6. systemd 服务

复制示例：

```bash
cp /opt/imagegen-platform/deploy/imagegen-platform.service.example /etc/systemd/system/imagegen-platform.service
```

如果你上传包里没有 `deploy` 目录，就直接新建：

```bash
nano /etc/systemd/system/imagegen-platform.service
```

内容：

```ini
[Unit]
Description=HEMA API Image Platform
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/imagegen-platform
Environment=NODE_ENV=production
Environment=PORT=4320
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启动：

```bash
systemctl daemon-reload
systemctl enable imagegen-platform
systemctl start imagegen-platform
systemctl status imagegen-platform
```

## 7. 挂到现有 Nginx

你现在已经有 `sub2api-gateway` 在 8080 对外。

最稳妥的方式不是再单开公网端口，而是把图片站挂成一个子路径或子域名。

更推荐子域名：

```text
img.hemasir.online -> 127.0.0.1:4320
```

Nginx 配置示例：

```nginx
server {
    listen 80;
    server_name img.hemasir.online;

    client_max_body_size 50M;

    location /_next/static/ {
        proxy_pass http://127.0.0.1:4320;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /generated/ {
        proxy_pass http://127.0.0.1:4320;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=86400";
    }

    location / {
        proxy_pass http://127.0.0.1:4320;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果你必须复用现有主域，也可以挂路径：

```text
https://hemasir.online/image
```

但 Next.js 做子路径会麻烦一点，子域名更干净。

## 8. 日志与排错

看服务日志：

```bash
journalctl -u imagegen-platform -f
```

看业务日志：

```bash
tail -f /opt/imagegen-platform/public/generated/logs/direct-image.log
```

看监听：

```bash
ss -lntp | grep 4320
```

看内存：

```bash
free -h
```

## 9. 更新方式

本机重新打包：

```bash
./deploy/build-standalone.sh
scp -P 2222 imagegen-platform-standalone.tar.gz root@23.94.68.252:/opt/
```

服务器更新：

```bash
systemctl stop imagegen-platform
rm -rf /opt/imagegen-platform/.next
tar -xzf /opt/imagegen-platform-standalone.tar.gz -C /opt/imagegen-platform
systemctl start imagegen-platform
```

不要删这两个目录：

```text
/opt/imagegen-platform/data
/opt/imagegen-platform/public/generated
```

## 10. 这台机器的现实建议

这台 1C1G 机器现在还能跑，是因为：

- 你已经把原来图片项目 Docker 容器删了
- 磁盘已经清出来了
- 主服务虽然健康，但内存其实已经很紧

所以别再做这些事：

- 不要再给图片项目单独上 `postgres`
- 不要再单独上 `redis`
- 不要再开第二套 `nginx`
- 不要再跑开发模式 `next dev`

应该做的是：

- 用 `standalone` 生产包
- 用 `systemd` 守护
- 用现有 nginx 反代
- 图片尽量走 R2，不在本机久存

## 11. 我给你的直接建议

你的最优落地方案就是：

1. 本机执行 `./deploy/build-standalone.sh`
2. 上传到 `/opt/imagegen-platform`
3. 服务器上 `npx prisma db push`
4. 建 `systemd` 服务监听 `4320`
5. 现有 nginx 加一个子域名反代

这套是最省内存、最不容易把你现在服务器搞挂的方案。
