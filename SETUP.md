# Flexi-Benefits 报销系统 - 部署配置指南

## 系统概述

本系统替代原飞书多维表格报销审核流程，提供独立 Web 应用。集成飞书生态：

- **OAuth 登录** — 员工用飞书账号免密登录
- **审批流** — 申请自动发送到飞书审批，HR 在飞书 APP 中审批
- **部门同步** — 从飞书多维表格连接器同步员工数据
- **轮询兜底** — 每 2 分钟自动检查审批状态，无需依赖 webhook

## 架构图

```
                                  ┌──────────────────────┐
浏览器 ──HTTPS──→ Nginx (:8443) ──→ Next.js App (:3000)  ──→ PostgreSQL (:5432)
                                  │                      │
                                  │  ├→ 飞书 OAuth       │
                                  │  ├→ 飞书审批 API     │
                                  │  └→ 飞书 Bitable API │
                                  └──────────────────────┘

飞书服务器 ─HTTPS─→ Nginx → /api/approval/webhook   （实时回调）
Poller 容器  ─HTTP─→ App  → /api/approval/poll       （每 2 分钟轮询）
```

> **飞书要求所有回调地址必须是 HTTPS**，包括 OAuth 重定向和 Webhook。
> 内网部署使用自签名证书 + Nginx 反向代理实现 HTTPS。

---

## 第一步：生成 HTTPS 证书

飞书 OAuth 和 Webhook 都要求 HTTPS。先生成自签名证书。

### 1.1 生成证书

```bash
# 用内网服务器 IP 生成（替换为你的实际 IP）
./scripts/gen-cert.sh YOUR_SERVER_IP 9000

# 或者用域名
./scripts/gen-cert.sh autoclaim.internal
```

脚本会在 `certs/` 目录生成证书，并打印后续配置提示。

### 1.2 客户端信任 CA 证书

员工电脑需要信任自签名 CA，否则浏览器会报"不安全"：

**macOS:**
```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain certs/ca.crt
```

**Ubuntu/Debian:**
```bash
sudo cp certs/ca.crt /usr/local/share/ca-certificates/autoclaim-ca.crt
sudo update-ca-certificates
```

**Windows:**
```
双击 ca.crt → 安装证书 → 本地计算机 → 受信任的根证书颁发机构
```

---

## 第二步：飞书开发者后台配置

打开应用管理页面：https://open.feishu.cn/app/cli_your_app_id

### 2.1 开通权限

进入 **权限管理**，搜索并开通：

| 权限 Scope | 用途 |
|------------|------|
| `approval:approval` | 创建审批定义 |
| `approval:instance` | 创建审批实例 |
| `approval:instance:read` | 读取审批实例状态（轮询） |
| `bitable:app:readonly` | 读取部门表（员工同步） |
| `contact:user.base:readonly` | OAuth 登录获取用户信息 |

### 2.2 配置 OAuth 重定向 URL

进入 **安全设置** → **重定向 URL**，添加以下全部地址：

```
https://YOUR_SERVER_IP:8443/api/auth/callback
https://localhost:8443/api/auth/callback
https://open.feishu.cn/api-explorer/loading
```

> **格式说明**：`{NEXT_PUBLIC_APP_URL}/api/auth/callback`
>
> 每个地址的用途：
> | URL | 用途 |
> |-----|------|
> | `https://YOUR_SERVER_IP:8443/api/auth/callback` | 生产环境，内网 IP 直连 |
> | `https://localhost:8443/api/auth/callback` | 本地开发调试 |
> | `https://open.feishu.cn/api-explorer/loading` | 飞书 API 调试工具 |
>
> 如果 IP 或端口有变化，需要同步更新这里。

### 2.3 配置事件订阅（Webhook）

进入 **事件与回调** → **事件订阅**：

1. **请求地址**：`https://YOUR_SERVER_IP:8443/api/approval/webhook`
2. 点击 **验证** — 系统会自动应答 challenge
3. 复制 **Verification Token** → 填入 `.env` 的 `FEISHU_VERIFICATION_TOKEN`
4. **加密策略**：选择不加密（或复制 Encrypt Key 填入 `FEISHU_ENCRYPT_KEY`）
5. **订阅事件**：搜索并添加 `审批实例状态变更`（`approval.instance.status_changed`）

> **如果验证失败**：说明飞书服务器无法访问你的内网地址。这种情况下可以不配 webhook，系统的 poller 容器会每 2 分钟自动轮询审批状态，HR 也可以在 Web 页面手动点击同步。

### 2.4 发布应用

进入 **应用发布** → **版本管理与发布** → 创建新版本 → 提交发布。

> 未发布的应用，OAuth 和审批只对开发者本人生效。发布后全员可用。

---

## 第三步：环境变量

编辑项目根目录的 `.env` 文件：

```env
# ─── 数据库 ───
# 本地开发用 localhost，Docker 部署用 db（docker-compose 服务名）
DATABASE_URL="postgresql://autoclaim:autoclaim@localhost:5432/autoclaim?schema=public"

# ─── 飞书应用凭证 ───
# 来源：开发者后台 → 凭证与基础信息
FEISHU_APP_ID="cli_your_app_id"
FEISHU_APP_SECRET="<从开发者后台复制>"
FEISHU_BASE_URL="https://open.feishu.cn"

# ─── 飞书多维表格（部门同步数据源）───
FEISHU_BITABLE_TOKEN="<your_bitable_token>"
FEISHU_DEPT_TABLE_ID="<your_table_id>"

# ─── 飞书审批 ───
FEISHU_APPROVAL_CODE="<your_approval_code>"
# 来源：开发者后台 → 事件订阅页面（如果不配 webhook 可留空）
FEISHU_VERIFICATION_TOKEN=""
FEISHU_ENCRYPT_KEY=""

# ─── 应用配置 ───
NEXTAUTH_SECRET="<用 openssl rand -base64 32 生成>"
# !! 关键：必须和飞书后台配置的重定向 URL 的域名/IP+端口一致 !!
NEXT_PUBLIC_APP_URL="https://YOUR_SERVER_IP:8443"
NEXT_PUBLIC_FEISHU_APP_ID="cli_your_app_id"

# ─── 管理员 ───
# HR 的飞书 open_id，逗号分隔
ADMIN_UIDS="ou_your_admin_open_id"

# ─── HTTPS 端口（docker-compose 用）───
HTTPS_PORT=9000
```

### 关键：`NEXT_PUBLIC_APP_URL` 必须和重定向 URL 匹配

```
.env 中设置：           NEXT_PUBLIC_APP_URL="https://YOUR_SERVER_IP:8443"
飞书后台重定向 URL：    https://YOUR_SERVER_IP:8443/api/auth/callback
                                ↑ 这两个的协议+host+端口必须完全一致 ↑
```

如果不一致，OAuth 登录会报错。

---

## 第四步：部署启动

### 方式 A：本地开发

```bash
# 1. 启动数据库
docker compose up -d db

# 2. 数据库迁移
npx prisma migrate dev

# 3. 生成 Prisma Client
npx prisma generate

# 4. 启动开发服务器（HTTP，端口 3000）
npm run dev

# 5. 快速登录（绕过飞书 OAuth，仅开发环境可用）
#    浏览器打开 http://localhost:3000/api/auth/dev-login
```

> 本地开发如果不需要测试飞书 OAuth，直接用 dev-login 即可。
> 如果要测试 OAuth，需要启动 nginx 提供 HTTPS（见方式 B）。

### 方式 B：Docker 生产部署

```bash
# 1. 确保 .env 已配置（见第三步）

# 2. 生成证书（如果还没生成）
./scripts/gen-cert.sh YOUR_SERVER_IP 9000

# 3. 构建并启动所有服务
docker compose --profile production up -d --build

# 4. 运行数据库迁移
docker compose exec app npx prisma migrate deploy

# 5. 验证
docker compose --profile production ps
```

启动后的服务：

| 服务 | 地址 | 说明 |
|------|------|------|
| nginx | `https://YOUR_SERVER_IP:8443` | HTTPS 入口，对外唯一入口 |
| app | `http://localhost:3000`（内部） | Next.js，由 nginx 代理 |
| db | `localhost:5432`（内部） | PostgreSQL |
| poller | 无端口 | 每 2 分钟轮询飞书审批状态 |

### 验证清单

```bash
# 1. 所有容器 running
docker compose --profile production ps

# 2. HTTPS 可访问
curl -k https://YOUR_SERVER_IP:8443/api/auth/me
# 预期：{"user":null}（未登录，但接口正常）

# 3. Webhook challenge 验证
curl -k -X POST https://YOUR_SERVER_IP:8443/api/approval/webhook \
  -H "Content-Type: application/json" \
  -d '{"challenge":"test123"}'
# 预期：{"challenge":"test123"}

# 4. 浏览器打开 https://YOUR_SERVER_IP:8443
#    点击 Login with Feishu → 跳转飞书授权 → 授权后跳回系统
```

---

## 第五步：初始数据

### 5.1 同步员工

1. 用管理员账号登录
2. 进入 **Employees** 页面 → 点击 **"Sync from Feishu"**

或 API 调用：
```bash
curl -k -b cookies.txt -X POST https://YOUR_SERVER_IP:8443/api/sync/employees
```

### 5.2 确认管理员

员工首次登录后会自动创建账号。查看所有员工的 open_id：

```bash
docker compose exec db psql -U autoclaim \
  -c "SELECT id, feishu_uid, name_en, name_cn FROM employees ORDER BY id;"
```

将 HR 的 `feishu_uid` 添加到 `.env` 的 `ADMIN_UIDS`（逗号分隔），然后重启：

```bash
docker compose --profile production up -d app
```

---

## 审批流程

### 完整链路

```
员工在 Web 提交申请
  ↓
系统创建飞书审批实例（FEISHU_APPROVAL_CODE 配置后自动触发）
  ↓
HR 在飞书 APP 收到审批通知，点击通过/拒绝
  ↓
审批结果回传（三重保障）：
  ├─ Webhook 实时推送          ← 最快，需 HTTPS 可达
  ├─ Poller 每 2 分钟轮询      ← 自动兜底，无需额外配置
  └─ Web 管理页手动同步        ← 点击 "Sync Feishu Approvals"
  ↓
审批通过后自动计算：
  ├─ 按月拆分报销金额
  └─ 扣除年度上限后的实际报销额
```

### 不依赖飞书的备选方案

HR 可以直接在 Web 管理页面（Approvals）点击 Approve/Reject，完全不经过飞书审批。适用于飞书服务不可用或审批紧急的情况。

---

## 业务规则

| 规则 | 公式/说明 |
|------|----------|
| 年度上限 | 每人每年 **1000 SGD** |
| 新人折算 | `上限 = 1000 × (13 - 入职月份) / 12`，例：7月入职 → 500 SGD |
| 报销类别 | Vision / Wellness Program / Insurance（三类共享同一额度） |
| 月度拆分 | `每月金额 = 总金额 ÷ 总月数` |
| 实际报销 | `MAX(0, MIN(年度上限 - 本月前累计已报, 当月金额))` |

**举例**：某员工先后提交两笔申请

| 申请 | 类别 | 金额 | 区间 | 月数 | 每月 |
|------|------|------|------|------|------|
| #1 | Vision | 450 | 3~5月 | 3 | 150 |
| #2 | Insurance | 800 | 6~9月 | 4 | 200 |

实际报销计算：

| 月份 | 当月金额 | 累计已报 | 实际报销 | 说明 |
|------|---------|---------|---------|------|
| 3月 | 150 | 0 | 150 | |
| 4月 | 150 | 150 | 150 | |
| 5月 | 150 | 300 | 150 | |
| 6月 | 200 | 450 | 200 | |
| 7月 | 200 | 650 | 200 | |
| 8月 | 200 | 850 | **150** | 剩余 1000 - 850 = 150 |
| 9月 | 200 | 1000 | **0** | 已达上限 |

---

## 常见问题

### OAuth 登录

| 现象 | 排查 |
|------|------|
| 点击登录后飞书报 redirect_uri 错误 | 检查飞书后台的重定向 URL 是否和 `NEXT_PUBLIC_APP_URL` + `/api/auth/callback` **完全一致**（协议、IP、端口都要一样） |
| 飞书授权后页面白屏或报 auth_failed | 检查 `FEISHU_APP_SECRET` 是否正确；检查应用是否已发布 |
| 登录成功但看不到管理菜单 | 确认 `ADMIN_UIDS` 包含你的 `open_id` 并重启应用 |
| 浏览器报 ERR_CERT_AUTHORITY_INVALID | 客户端未信任自签名 CA 证书（见第一步 1.2） |

### Webhook

| 现象 | 排查 |
|------|------|
| 飞书验证请求地址失败 | 飞书服务器无法访问内网 IP → 这是正常的，用轮询兜底即可 |
| 验证通过但审批后状态不同步 | 检查是否订阅了 `approval.instance.status_changed` 事件 |
| 以上都配了但还是不更新 | 查日志 `docker compose logs app \| grep Webhook` |

> **注意**：webhook 需要飞书服务器能访问你的内网地址。如果公司网络不允许，完全依赖轮询也没问题。

### 审批

| 现象 | 排查 |
|------|------|
| 提交成功但飞书没收到审批 | 检查 `FEISHU_APPROVAL_CODE` 是否配置 |
| 飞书报审批权限不足 | 开通 `approval:instance` 权限并发布应用 |
| 飞书报表单字段错误 | 审批定义的字段 widget1~5 已固定，不要修改审批定义 |
| 轮询同步没有效果 | 检查 `approval:instance:read` 权限；查看 poller 日志 `docker compose logs poller` |
