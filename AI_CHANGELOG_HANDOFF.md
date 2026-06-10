# 图片站改动交接记录

更新时间：2026-06-10，北京时间

这份文档给下一位接手的 AI / 工程师看。重点是：图片站代码改了什么、哪些地方容易踩坑、线上不要乱动什么。

## 当前仓库状态

- 项目目录：`/Users/hemasir/Documents/imagegen-platform/imagegen-platform`
- 当前分支：`codex/ui-work`
- 当前提交：以 `git log --oneline -5` 为准
- 当前本地工作区：以 `git status --short --branch` 为准

## 2026-06-10 继续优化重点

本轮目标是把 `image.hemasir.online` 图片站继续推到 9.5 分，重点修 `/studio` 的真实使用体验和线上可维护性。

已完成的关键改动：

- `/studio` UI 再压缩：
  - 桌面 1280×720 下左侧表单完整进入首屏
  - 移动端 390×844 下生成按钮和表单完整进入首屏
  - 尺寸按钮更紧凑，避免 16px / 16px / 40px 这种突兀间距
- 尺寸选择修复：
  - 只允许合法尺寸值
  - localStorage 里如果有旧值或坏值，会自动回到默认 `1024x1024`
  - 不再出现 0 个选中或多个视觉选中
- 历史图比例修复：
  - 优先按图片真实 `naturalWidth / naturalHeight` 展示
  - 数据库存的任务尺寸只做兜底
  - 避免 16:9 / 9:16 标记和上游真实返回比例不一致时被错误裁切
- 删除体验修复：
  - 前端从原生 `alert/confirm` 改为站内确认弹层和 toast
  - 删除失败任务也有入口
  - 删除中按钮禁用，成功后卡片直接消失
- 删除后端修复：
  - 兼容 CDN URL、`/generated/...`、`generated/...` 多种路径
  - 普通入口只查 direct 历史，KV 入口只查 KV 历史，避免串数据
- 下载链路修复：
  - 新增 `/api/direct-generate/download`
  - 登录后才能下载
  - 只允许下载本站 `/generated/...` 和 `https://cdn.hemasir.online/...`
- 生成卡住恢复：
  - RUNNING 超过 5 分钟自动回到 PENDING
  - worker 启动时和每分钟都会扫描恢复
- 上游地址：
  - 代码默认改成本机直连 `http://127.0.0.1:8080/v1`
  - 文档和 env 示例也统一成本机直连
- 清理：
  - 删除旧的 `src/app/new-home-studio.backup.tsx`，避免旧 alert/confirm 代码污染搜索和交接判断

本地验证结果：

- `npm test`：5 个测试文件，20 个测试通过
- `npm run build`：通过，仅 BullMQ 动态依赖 warning
- standalone 启动流程已验证：
  - `cp -R .next/static .next/standalone/.next/`
  - 从 `.next/standalone` 执行 `PORT=4320 HOSTNAME=127.0.0.1 node server.js`
- 浏览器实测：
  - 桌面 1280×720：无横向溢出，左侧表单 bottom 671，生成按钮 bottom 634
  - 移动 390×844：无横向溢出，表单 bottom 820，生成按钮 bottom 783
  - 尺寸选中数量：1
  - 前 8 张历史图渲染比例与真实图片比例一致
  - 控制台 error：0

## 最近三次主要提交

### 1. `0031106 Revamp admin operations and KV queue flow`

主要做了后台运营中心和 KV 队列流程：

- 新增/改造后台页面：
  - `/admin`
  - `/admin/users`
  - `/admin/users/[userId]`
  - `/admin/usage`
  - `/admin/usage/[taskId]`
  - `/admin/images`
  - `/admin/tasks`
  - `/admin/transactions`
  - `/admin/redeem-codes`
  - `/admin/audit-logs`
  - `/admin/security`
  - `/admin/settings`
  - `/admin/verify`
- 使用记录后台：
  - 任务数
  - 图片数
  - 积分消耗
  - 成功率 / 失败率
  - 平均耗时
  - 用户消耗排行
  - 任务详情和生成链路信息
- 兑换码后台：
  - 批次统计
  - 状态筛选
  - 搜索
  - CSV 下载接口：`/admin/redeem-codes/download`
- 管理员安全：
  - 管理员二次验证密钥
  - 管理员安全配置入口
- KV 生成：
  - `/kv` 入口
  - `/api/kv/analyze` 用 LLM 分析商品图并生成 KV 场景 prompt
  - 前端提交后进入队列，而不是只停留在“分析生成提示词”

核心文件：

- `src/app/new-home-studio.tsx`
- `src/app/api/kv/analyze/route.ts`
- `src/app/admin/usage/page.tsx`
- `src/app/admin/images/page.tsx`
- `src/app/admin/tasks/page.tsx`
- `src/app/admin/redeem-codes/page.tsx`
- `src/app/admin/security/page.tsx`
- `src/lib/services/admin-mfa.ts`
- `src/lib/actions/admin-actions.ts`
- `src/lib/utils/format.ts`

### 2. `9a8738d Revamp admin growth tools and task retry`

主要做了增长工具、活动积分、邀请码注册、KV 上游失败静默重试：

- 活动积分：
  - 新增 `CreditCampaign`
  - 新增 `TemporaryCreditGrant`
  - 支持给一批用户发短期积分
  - 消耗顺序：先消耗最早过期的短期积分，再消耗其他短期积分，最后消耗永久余额
  - 适合“上线活动一天免费用”这种场景
- 邀请码注册：
  - 后台可开关“必须邀请码注册”
  - 普通用户自动拥有 5 个一次性邀请码
  - 后台可批量生成邀请码
  - 邀请码支持批次、过期时间、最大使用次数
  - 新增 CSV 下载接口：`/admin/invite-codes/download`
- 新用户活动奖励：
  - 后台可配置注册后自动发短期活动积分
  - 可配置仅邀请码注册用户领取
- 兑换码：
  - 支持短期兑换码
  - 短期兑换码兑换后进入短期积分池，优先消耗，到期失效
- KV 上游失败重试：
  - 只针对直接生成 / KV 队列链路
  - 上游返回 408 / 429 / 500 / 502 / 503 / 504 或网络失败时，可静默重试
  - 用户前端不直接展示第一次上游失败
  - 非上游错误，例如本地缺 key、参数错，不重试
- 后台用户详情：
  - 可给单个用户发短期积分
  - 可查看活动积分情况

核心文件：

- `prisma/schema.prisma`
- `src/lib/services/wallet.ts`
- `src/lib/services/registration-invites.ts`
- `src/lib/services/direct-tasks.ts`
- `src/lib/services/tasks.ts`
- `src/lib/auth.ts`
- `src/app/admin/campaigns/page.tsx`
- `src/app/admin/invite-codes/page.tsx`
- `src/app/admin/security/page.tsx`
- `src/app/auth/register/page.tsx`
- `src/app/credits/page.tsx`
- `src/components/admin-center-frame.tsx`
- `src/components/admin-center-nav.tsx`

测试文件：

- `src/lib/services/wallet.test.ts`
- `src/lib/services/direct-tasks.test.ts`

### 3. `5115785 Limit pending prompt cards to KV mode`

这是最后一次小修。

问题：

- `/studio` 普通图片生成时，也会显示 KV 专用的“生成提示词”占位卡。
- 这个占位卡本来只应该在 `/kv` 模式展示。

改动：

- 文件：`src/app/new-home-studio.tsx`
- 把 pending prompt 卡的显示条件改成：

```tsx
isKvMode && pendingCard.prompt
```

结果：

- `/kv`：队列占位图里继续显示 LLM 生成的 prompt。
- `/studio`：普通直接生成不再显示 KV prompt 占位。

## 数据库改动

`prisma/schema.prisma` 增加/调整了这些重要模型或字段：

- `CreditCampaign`
- `TemporaryCreditGrant`
- 注册邀请码相关模型
- 任务重试计数字段：`retryCount`
- 兑换码短期积分字段：
  - `creditType`
  - `grantExpiresInHours`

注意：

- 本地仓库 Prisma schema 当前按 PostgreSQL 配置。
- 之前线上图片站实际使用 SQLite。下一位部署时必须确认生产 schema / Prisma client 和生产数据库一致。
- 不要在生产上盲目执行 `prisma db push` 或 `prisma generate`，否则可能把 SQLite / PostgreSQL 搞混。

## 环境变量和请求链路

图片站不是直接请求 OpenAI 官方默认地址。线上要求走服务器本机直连上游：

```env
OPENAI_BASE_URL="http://127.0.0.1:8080/v1"
```

相关文件：

- `README.md`
- `.env.example`
- `deploy/production.env.example`
- `deploy/DEPLOY.md`
- `src/lib/services/image-provider.ts`
- `src/app/api/kv/analyze/route.ts`

注意：

- 用户明确说过：线上都是本机直连。
- 线上 `OPENAI_BASE_URL` 应保持 `http://127.0.0.1:8080/v1`，不要改回公网网关或 OpenAI 官方默认地址。

## 已做过的本地验证

在最后一次部署前，本地跑过：

```bash
npx tsc --noEmit
npm run lint
npm run build
```

结果：

- TypeScript 通过
- Lint 通过
- Build 通过
- 构建时存在 BullMQ 动态依赖 warning，属于已知非阻断警告

## 线上相关记录

以下是之前排查线上时做过的事情，写出来是为了避免下一个人重复踩坑。

图片站：

- 服务名：`imagegen-platform.service`
- 运行端口：`4320`
- 线上目录：`/opt/imagegen-platform`
- 当时部署到的 release commit：`5115785`
- 当时确认 `https://image.hemasir.online/` 返回过 200，并且返回最新静态 chunk：
  - `/_next/static/css/65e6eac6d7f9375c.css`
  - `/_next/static/chunks/app/page-20f16235fb6a9db6.js`

主站 `hemasir.online`：

- 这不是图片站本体。
- Cloudflare Tunnel 当时的路由关系里，`hemasir.online` 指向服务器本地 `localhost:8080`。
- 这个端口属于 sub2api / hemaAPI 那条链路。
- 用户后面明确说过：不要乱动其他服务。

所以后续接手时必须分清：

- `image.hemasir.online`：图片站
- `hemasir.online`：主站 / hemaAPI / sub2api 网关
- `ops.hemasir.online`：ops 后台

不要把三者混在一起部署或重启。

## 下一位接手时建议先做的检查

只检查图片站时：

```bash
git status --short --branch
git log --oneline -5
npm run lint
npx tsc --noEmit
npm run build
```

检查线上图片站是否真的是最新，不要只看 HTTP 200：

```bash
curl -sS -D /tmp/image_headers.txt -o /tmp/image.html https://image.hemasir.online/
rg -o '/_next/static/[^" ]+' /tmp/image.html | sed -n '1,12p'
```

如果要查主站 502，只能查 `hemasir.online` 自己那条链路，不要顺手动图片站。

## 绝对不要做的事

- 不要把 `hemasir.online`、`image.hemasir.online`、`ops.hemasir.online` 当成同一个服务。
- 不要为了修主站 502 去重启图片站。
- 不要为了修图片站去重启 sub2api。
- 不要把线上 `OPENAI_BASE_URL` 改回公网网关或 OpenAI 官方默认地址。
- 不要在生产上盲目切换 SQLite / PostgreSQL Prisma schema。
- 不要只用 “HTTP 200” 判断部署成功，要核对 Next 静态 chunk 是否是最新构建。
