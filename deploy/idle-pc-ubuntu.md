# Idle PC Ubuntu Deployment

This project can run on an idle Ubuntu machine as a single Next.js app with SQLite, local image storage, PM2, and optional Cloudflare Tunnel.

## Minimum machine

- Recommended: 2 CPU / 4 GB RAM / 80 GB disk
- Minimum: 1 CPU / 2 GB RAM / 40 GB disk
- Works for testing: 1 CPU / 1 GB RAM with 2 GB swap

## 1. Install base packages

```bash
sudo apt update
sudo apt install -y git curl nginx

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

sudo npm i -g pm2
```

If RAM is 1 GB, add swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 2. Clone and configure

```bash
sudo mkdir -p /opt/imagegen-platform
sudo chown -R "$USER":"$USER" /opt/imagegen-platform

git clone YOUR_PRIVATE_GITHUB_REPO_URL /opt/imagegen-platform
cd /opt/imagegen-platform

cp deploy/production.env.example .env
nano .env
```

Required production values:

```env
DATABASE_URL="file:/opt/imagegen-platform/data/prod.db"
OPENAI_API_KEY=""
OPENAI_BASE_URL="http://127.0.0.1:8080/v1"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_FALLBACK_IMAGE_MODEL="gpt-image-2"
OPENAI_WIRE_API="images"
OPENAI_REQUEST_TIMEOUT_MS="300000"
```

Create storage directories:

```bash
mkdir -p /opt/imagegen-platform/data
mkdir -p /opt/imagegen-platform/public/generated
```

## 3. Install, migrate, build, start

```bash
npm ci
npx prisma generate
npx prisma db push
npm run build

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Check:

```bash
pm2 status
curl -I http://127.0.0.1:3000
```

## 4. Nginx reverse proxy

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/imagegen-platform
sudo nano /etc/nginx/sites-available/imagegen-platform
sudo ln -sf /etc/nginx/sites-available/imagegen-platform /etc/nginx/sites-enabled/imagegen-platform
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Cloudflare Tunnel option

Use this if the idle PC has no public IP or you do not want router port forwarding.

```bash
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared

cloudflared tunnel login
cloudflared tunnel create imagegen-platform
cloudflared tunnel route dns imagegen-platform your-domain.example.com
```

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: imagegen-platform
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: your-domain.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Start tunnel:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

## 6. Update deployment

```bash
cd /opt/imagegen-platform
git pull
npm ci
npx prisma generate
npx prisma db push
npm run build
pm2 restart imagegen-platform
```

## 7. Backup

Back up these paths:

```bash
/opt/imagegen-platform/data/prod.db
/opt/imagegen-platform/public/generated
/opt/imagegen-platform/.env
```
