# HEMA API Image 部署指南

目标架构：

```text
Nginx -> Next.js Web
          |
          +-> Postgres：用户、积分、任务、流水
          +-> Redis/BullMQ：生成任务队列
          +-> Worker：调用上游并上传 R2
```

## 1. 服务器组件

Ubuntu 24.04：

```bash
apt update
apt install -y curl git nginx postgresql redis-server
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
```

## 2. 数据库

```bash
sudo -u postgres psql
```

```sql
CREATE USER imagegen WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE imagegen OWNER imagegen;
\q
```

## 3. 项目目录

```bash
mkdir -p /opt/imagegen-platform
cd /opt/imagegen-platform
```

上传项目或 standalone 包后，创建 `.env`：

```env
DATABASE_URL="postgresql://imagegen:CHANGE_ME@127.0.0.1:5432/imagegen"
REDIS_URL="redis://127.0.0.1:6379"

ADMIN_EMAIL="admin@flux.local"
ADMIN_PASSWORD="change-this-password"

DIRECT_WORKER_CONCURRENCY="10"
USER_PENDING_LIMIT="20"

OPENAI_API_KEY=""
OPENAI_BASE_URL="https://hemasir.online/v1"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_WIRE_API="images"

OBJECT_STORAGE_ENDPOINT=""
OBJECT_STORAGE_REGION="auto"
OBJECT_STORAGE_BUCKET=""
OBJECT_STORAGE_ACCESS_KEY_ID=""
OBJECT_STORAGE_SECRET_ACCESS_KEY=""
OBJECT_STORAGE_PUBLIC_BASE_URL=""
```

## 4. 初始化

```bash
npm ci
npx prisma generate
npx prisma db push
npm run build
```

## 5. 启动

PM2：

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

检查：

```bash
pm2 status
pm2 logs imagegen-platform
pm2 logs imagegen-worker
```

## 6. Nginx

```nginx
server {
    listen 80;
    server_name image.hemasir.online;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 7. 推荐参数

8GB 服务器先用：

```env
DIRECT_WORKER_CONCURRENCY="10"
USER_PENDING_LIMIT="20"
```

稳定后可以试：

```env
DIRECT_WORKER_CONCURRENCY="15"
```

## 8. 更新

```bash
git pull
npm ci
npx prisma generate
npx prisma db push
npm run build
pm2 restart ecosystem.config.cjs
```

## 9. 验证

```bash
curl -I http://127.0.0.1:3000
redis-cli ping
sudo -u postgres psql -d imagegen -c 'select count(*) from "User";'
```
