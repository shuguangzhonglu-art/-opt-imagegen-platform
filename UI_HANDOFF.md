# 图片生成网站 UI 交接

## 项目

- 项目路径：`/Users/hemasir/Documents/图片生成网站项目/imagegen-platform`
- 本地服务：`http://127.0.0.1:4320`
- 线上地址：`https://image.hemasir.online`
- 当前 UI 分支：`codex/ui-work`

## 重要边界

- 只改图片生成网站：`imagegen-platform`
- 不要动主站：`hemasir.online`
- 不要动旧图片入口：`img.hemasir.online`
- 不要动 sub2api 主程序
- 这是独立子域名外挂站点

## 已完成

- 已部署到新服务器：`hemasir@23.254.234.15`
- 已配置域名：`image.hemasir.online`
- Web / Worker / Nginx / Postgres / Redis 都已启动
- 已有用户系统、管理员后台、积分、兑换码、邮箱验证、Turnstile
- Cloudflare Turnstile 已生成并写入后台
- 管理员登录：
  - 地址：`https://image.hemasir.online/auth/login`
  - 账号：`admin@flux.local`
  - 密码：`Hema@2026Image`

## 最近 UI 改动

- 注册页已按整体调性优化
- Turnstile 验证区已融入注册卡片
- 移动端做了防挤压处理
- 已本地 build 通过并部署线上

## 当前本地 UI 进度

- 工作台首页继续优化中，改动集中在：
  - `src/app/new-home-studio.tsx`
  - `src/app/globals.css`
- 已把尺寸下拉框改成尺寸分段按钮，保留隐藏 `size` 字段提交。
- 历史图片卡片增加尺寸 / 日期浮层和提示词预览。
- 历史图片操作按钮统一成稳定 ASCII 控件：`D` 下载、`R` 重试、`P` 复用提示词、`E` 设为参考图、`X` 删除。
- 顶部账号区域改成可换行，移动端降低卡片圆角和高度，减少挤压。
- 本地 `npm run build` 已通过；仍有 BullMQ 动态依赖警告，这是既有警告，非本轮 UI 引入。
- 尚未部署线上；部署前还需要本地浏览器确认桌面 / 移动端视觉。

## 当前登录页本地设计

- 用户已确认先本地设计，确认后再部署服务器。
- 登录页改动集中在：
  - `src/app/auth/login/page.tsx`
  - `src/app/globals.css`
- 登录页已从基础单卡片升级为双栏产品登录页：
  - 左侧：品牌条、产品说明、能力状态块。
  - 右侧：邮箱 / 密码登录表单、错误 / 成功提示、注册链接。
- 登录表单仍使用 `loginAction`，保留 `redirectTo` 隐藏字段。
- 本地 `npm run build` 已通过；BullMQ 动态依赖警告仍为既有警告。
- 本地浏览器已确认桌面渲染正常，`http://127.0.0.1:4320/auth/login` 可查看。
- 尚未部署线上。

## 当前路由语义

- `http://127.0.0.1:4320/new-home` 是客户看到的官网首页，不再是生成控制台。
- 登录后的生成控制台为 `http://127.0.0.1:4320/studio`。
- 未登录访问 `/studio` 会跳转到 `/auth/login?redirectTo=%2Fstudio`。
- 后台“返回画布”链接应指向 `/studio`，不要回到 `/` 或 `/new-home`。

## 新对话继续方式

新对话第一句话可以直接发：

```text
继续图片生成网站 UI。项目路径：/Users/hemasir/Documents/图片生成网站项目/imagegen-platform。当前 UI 分支：codex/ui-work。本地服务：http://127.0.0.1:4320。只改 imagegen-platform 的 UI，不要动 hemasir.online、img.hemasir.online、sub2api 主程序。本地确认后再部署到 https://image.hemasir.online。
```

## 常用页面

- 首页：`http://127.0.0.1:4320/`
- 登录：`http://127.0.0.1:4320/auth/login`
- 注册：`http://127.0.0.1:4320/auth/register`
- 用户后台：`http://127.0.0.1:4320/admin/users`
- 兑换码后台：`http://127.0.0.1:4320/admin/redeem-codes`
- 安全配置：`http://127.0.0.1:4320/admin/security`

## 本地命令

```bash
cd /Users/hemasir/Documents/图片生成网站项目/imagegen-platform
git branch --show-current
npm run build
npm run start:local
```

## 部署提醒

部署只推图片站到新服务器 `hemasir@23.254.234.15`。

不要再部署到旧服务器 `root@23.94.68.252`。
