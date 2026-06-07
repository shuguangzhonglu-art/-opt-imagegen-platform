# Windows Docker Deployment

Use this when the idle computer is Windows and already has Docker Desktop.

## 1. Install required tools

- Docker Desktop
- Git for Windows
- Optional but recommended: Cloudflare Tunnel (`cloudflared`)

You do not need to install Node.js on Windows when using Docker.

## 2. Clone project

Open PowerShell:

```powershell
cd C:\
git clone YOUR_PRIVATE_GITHUB_REPO_URL imagegen-platform
cd C:\imagegen-platform
```

## 3. Configure environment

```powershell
copy deploy\production.env.example .env
notepad .env
```

Use this shape:

```env
DATABASE_URL="file:/app/data/prod.db"

TASK_POLL_MS="4000"

OPENAI_API_KEY=""
OPENAI_BASE_URL="https://hemasir.online/v1"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_FALLBACK_IMAGE_MODEL="gpt-image-2"
OPENAI_WIRE_API="images"
OPENAI_REQUEST_TIMEOUT_MS="300000"
```

Create persistent folders:

```powershell
mkdir data
mkdir public\generated
```

## 4. Build and start

```powershell
docker compose up -d --build
```

Check status:

```powershell
docker compose ps
docker compose logs -f imagegen-platform
```

Open:

```text
http://localhost:3000
```

## 5. Update deployment

```powershell
cd C:\imagegen-platform
git pull
docker compose up -d --build
```

## 6. Stop / restart

```powershell
docker compose stop
docker compose restart
```

## 7. Back up

Back up these paths:

```text
C:\imagegen-platform\.env
C:\imagegen-platform\data
C:\imagegen-platform\public\generated
```

## 8. Public access with Cloudflare Tunnel

If the Windows computer is at home or behind a router, use Cloudflare Tunnel instead of router port forwarding.

Install `cloudflared`, then:

```powershell
cloudflared tunnel login
cloudflared tunnel create imagegen-platform
cloudflared tunnel route dns imagegen-platform your-domain.example.com
```

Create:

```text
C:\Users\YOUR_WINDOWS_USER\.cloudflared\config.yml
```

Example:

```yaml
tunnel: imagegen-platform
credentials-file: C:\Users\YOUR_WINDOWS_USER\.cloudflared\YOUR_TUNNEL_ID.json

ingress:
  - hostname: your-domain.example.com
    service: http://localhost:3000
  - service: http_status:404
```

Run:

```powershell
cloudflared tunnel run imagegen-platform
```

For a long-running Windows machine, install cloudflared as a service after the tunnel works.
