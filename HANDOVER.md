# Flexi-Benefits 报销系统 — 交接文档

> 最后更新：2026-05-11 | 作者：<developer_name>
> 本文档面向后续开发者或 AI 助手，包含完整的项目背景、架构、部署、运维信息。

---

## 一、项目背景

### 1.1 业务场景

DesaySV 新加坡公司为每位员工提供年度 **1000 SGD** 的弹性福利额度（Flexi-Benefits），覆盖三个类别：
- **Vision** — 眼镜、隐形眼镜、视力检查
- **Wellness Program** — 健身、健康计划
- **Insurance** — 健康和人寿保险

员工提交报销申请，HR（Jenny ANG）审批通过后，报销金额按月拆分随工资发放。

### 1.2 系统历史

| 阶段 | 方案 | 问题 |
|------|------|------|
| 旧方案 | 飞书多维表格 + 工作流 | UI 难用，字段爆炸（每月×类别都是独立列），维护困难 |
| 新方案（本项目） | 飞书审批表单 + Web 管理后台 | 员工体验不变（飞书提交），HR 有专业报表 |

### 1.3 核心决策

- **员工不直接访问 Web 应用** — 通过飞书 APP 内的审批表单提交申请，无需内网/VPN/证书
- **Web 后台仅 HR 使用** — 部署在内网服务器，自签名 HTTPS，只有几个管理员需要安装 CA 证书
- **飞书审批定义通过 API 管理** — 审批人可在 Web Settings 页面切换，无需飞书管理员权限

---

## 二、系统架构

```
员工（任何网络）
  └→ 飞书 APP → 发起「弹性福利报销申请」→ 自动发送给指定审批人（Jenny）

飞书审批人（Jenny）
  └→ 飞书 APP → 收到通知 → 通过/拒绝

内网服务器 (YOUR_SERVER_IP)
  ┌──────────────────────────────────────────────────┐
  │  Nginx (:8443 HTTPS)                             │
  │    └→ Next.js App (:3000)                        │
  │         ├→ PostgreSQL (:5432)                     │
  │         ├→ 飞书 API（审批、Bitable、OAuth）         │
  │         └→ Poller（每2分钟同步审批状态）             │
  └──────────────────────────────────────────────────┘
  HR 浏览器 → https://YOUR_SERVER_IP:8443
```

### 数据流

```
1. 员工在飞书提交审批
2. Poller 每2分钟发现新审批实例 → 创建 claim 记录 → 如已审批则计算月度拆分
3. HR 在飞书审批 → Poller 同步状态 → 触发计算
4. HR 也可在 Web 端审批 → 同步回飞书
5. HR 在 Web 查看报表 → 导出 CSV → 按月发放工资
```

---

## 三、技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 前端 | Next.js (App Router) + React + Tailwind CSS | 16.2.4 / 19.2.4 / 4.x |
| 后端 | Next.js API Routes (Node.js) | 16.2.4 |
| ORM | Prisma (需要 @prisma/adapter-pg) | 7.8.0 |
| 数据库 | PostgreSQL | 16-alpine |
| 认证 | 飞书 OAuth + JWT (jose) | - |
| 部署 | Docker Compose + Nginx (自签名 HTTPS) | Docker 28.0.2 |

### Prisma 7 注意事项

Prisma 7 和旧版有重大差异：
- **不能**在 `schema.prisma` 的 datasource 里写 `url = env("DATABASE_URL")`，URL 在 `prisma.config.ts` 配置
- `PrismaClient` 构造**必须传 adapter**：`new PrismaClient({ adapter: new PrismaPg(...) })`
- 生成的 client 在 `src/generated/prisma/client`，不是 `@prisma/client`
- standalone 模式下容器内跑 `prisma migrate` 需要保留完整 `node_modules`（见 Dockerfile 的 `node_modules_full`）

---

## 四、项目结构

```
autoclaim/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # 首页（重定向到登录或管理后台）
│   │   ├── login/page.tsx              # 飞书 OAuth 登录页
│   │   ├── layout.tsx                  # 全局布局
│   │   ├── admin/                      # HR 管理后台
│   │   │   ├── approvals/page.tsx      # 审批管理（查看/通过/拒绝）
│   │   │   ├── reports/page.tsx        # 报表（3个视图 + 导出CSV）
│   │   │   ├── employees/page.tsx      # 员工列表
│   │   │   └── settings/page.tsx       # 设置（审批人/管理员/同步）
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── callback/route.ts   # 飞书 OAuth 回调
│   │       │   ├── dev-login/route.ts  # 开发后门登录
│   │       │   ├── me/route.ts         # 当前会话
│   │       │   └── logout/route.ts     # 登出
│   │       ├── claims/
│   │       │   ├── route.ts            # GET: 列表（admin only）
│   │       │   └── [id]/route.ts       # GET: 详情, PATCH: 审批（同步飞书）
│   │       ├── approval/
│   │       │   ├── poll/route.ts       # 核心：同步新提交 + 审批状态
│   │       │   └── webhook/route.ts    # 飞书 webhook 回调（备用）
│   │       ├── admin/
│   │       │   ├── employees/route.ts  # 员工列表
│   │       │   └── approver/route.ts   # 审批人查询/更新
│   │       ├── dev/admin/route.ts      # 管理员 CRUD
│   │       ├── sync/employees/route.ts # 从 Bitable 同步员工
│   │       └── reports/
│   │           ├── annual/route.ts     # 年度报表数据
│   │           └── monthly/route.ts    # 月度报表数据
│   ├── lib/
│   │   ├── auth.ts                     # JWT 会话管理，admin 判断从 DB 读取
│   │   ├── calculator.ts              # 核心：月度拆分 + actually_pay 计算
│   │   ├── db.ts                       # Prisma 单例（需要 PrismaPg adapter）
│   │   └── feishu.ts                   # 飞书 API 封装（OAuth/审批/同步）
│   ├── components/
│   │   ├── NavBar.tsx
│   │   └── StatusBadge.tsx
│   ├── types/index.ts
│   └── instrumentation.ts             # 内置 poller（每2分钟轮询审批状态）
├── prisma/
│   ├── schema.prisma                   # 数据库模型
│   └── migrations/                     # 3个迁移
├── scripts/
│   ├── gen-cert.sh                     # 自签名证书生成
│   ├── nginx-docker.conf               # 生产 nginx 配置
│   └── nginx-local.conf                # 本地开发 nginx 配置
├── docker-compose.yml
├── Dockerfile
├── docker-start.sh                     # 容器启动脚本（迁移+启动）
├── prisma.config.ts
└── .env                                # 环境变量（不提交 git）
```

---

## 五、核心业务逻辑

### 5.1 年度上限

```
每人每年 1000 SGD
新人折算：cap = 1000 × (13 - 入职月份) / 12
例：7月入职 → 1000 × 6/12 = 500 SGD
```

代码：`src/lib/calculator.ts` → `calculateAnnualCap()`

### 5.2 月度拆分（发放逻辑）

报销通过工资发放，关键规则：
- **只算当年部分**：跨年申请只计算当年的月份比例
- **从审批月开始发**：已过去的月份无法追溯，金额压缩到审批月及之后
- **年度封顶**：逐月累加，到 1000 SGD 上限为止

```
举例：员工6月提交申请，期间 2026-01 ~ 2026-12，金额 1200 SGD
→ 今年部分：12个月，1200 SGD
→ 发放月份：6~12月（7个月，1~5月已过）
→ 每月：1200 / 7 ≈ 171.43
→ actually_pay 按年度上限 1000 封顶
```

代码：`src/lib/calculator.ts` → `calculatePayoutMonths()` + `processApprovedClaim()`

### 5.3 审批流程

```
飞书端提交 → Poller 发现（/api/approval/poll）→ 创建 claim + 匹配员工
  → 如飞书已审批：status=approved → processApprovedClaim() → 月度拆分
  → 如待审批：status=pending → 等待下次 poll 或 HR 在 web 端操作

Web 端审批（/api/claims/[id] PATCH）→ 更新本地 DB + 同步回飞书
```

---

## 六、飞书集成

### 6.1 飞书应用信息

| 项 | 值 |
|----|-----|
| App ID | `cli_your_app_id` |
| 开发者后台 | https://open.feishu.cn/app/cli_your_app_id |
| 审批定义 Code | `<your_approval_code>` |
| Bitable Token | `<your_bitable_token>`（Wiki 内的多维表格） |
| 部门表 ID | `<your_table_id>` |

### 6.2 已开通的权限

| 权限 Scope | 身份 | 用途 |
|------------|------|------|
| `approval:approval` | 应用 | 创建/更新审批定义 |
| `approval:instance` | 应用 | 创建审批实例 |
| `approval:instance:read` | 应用 | 读取审批状态（轮询） |
| `bitable:app:readonly` | 用户 | 读取 Bitable 员工表 |
| `wiki:wiki:readonly` | 用户 | 访问 Wiki 内的 Bitable |
| `contact:user.base:readonly` | 用户 | OAuth 登录获取用户信息 |

### 6.3 OAuth 登录流程

```
Login 页面 → 飞书授权 → 回调 /api/auth/callback
  → getUserAccessToken（code 换 token）
  → /authen/v1/user_info（获取 open_id, name）
  → createSession（JWT cookie）
  → 存储 access_token/refresh_token 到 DB（用于 Bitable API）
  → 重定向到 /admin/approvals（admin）或 /login?error=not_admin（非admin）
```

OAuth 重定向 URL（需在飞书后台配置）：
```
https://YOUR_SERVER_IP:8443/api/auth/callback
https://localhost:8443/api/auth/callback
```

### 6.4 员工数据同步

Bitable 部门表通过飞书连接器自动同步公司人事数据。我们从中提取员工信息。

**关键：SourceID 编码**
Bitable 的 SourceID 是 base64 编码字符串，内含 `open_id`：
```
base64("<tenant_id>:ou_xxxx-employeeNo:hash:1")
```
同步时自动提取 `open_id` 作为 `feishuUid`，确保 OAuth 登录能匹配。

代码：`src/app/api/sync/employees/route.ts` → `extractOpenId()`

### 6.5 审批人管理

审批人通过 API 更新飞书审批定义（`POST /open-apis/approval/v4/approvals?user_id_type=open_id`）。

重要格式细节：
- `approval_name` 必须用 `@i18n@` 前缀
- `i18n_resources.texts` 是 `[{key, value}]` 数组格式
- `radioV2` 的选项放在 `value` 字段（不是 `option.value`）
- `Personal` 类型审批人用 `user_id` 字段传 `open_id`，同时 URL 加 `?user_id_type=open_id`

代码：`src/app/api/admin/approver/route.ts`

---

## 七、数据库

### 7.1 模型关系

```
Employee 1──N Claim 1──N MonthlyPayment
Employee 1──N MonthlyPayment
Config（key-value 存储，目前存 approver 信息）
```

### 7.2 关键字段说明

**Employee**
- `feishuUid`：飞书 `open_id`（`ou_xxx`），唯一标识
- `isAdmin`：Web 后台管理员权限，从 DB 读取（不是环境变量）
- `accessToken/refreshToken`：飞书 user token，用于 Bitable API 调用，自动刷新

**Claim**
- `approvalInstanceId`：飞书审批实例 Code，用于状态同步
- `status`：`pending` / `approved` / `rejected`

**MonthlyPayment**
- `amount`：分摊金额
- `actuallyPay`：实际发放金额（扣除年度上限后）

### 7.3 迁移

```
20260506102009_init          — 建表
20260511020545_add_user_tokens — Employee 加 token 字段
20260511031539_add_is_admin   — Employee 加 isAdmin 字段
```

---

## 八、部署与运维

### 8.1 服务器信息

| 项 | 值 |
|----|-----|
| 服务器 | A100 副本 |
| IP | `YOUR_SERVER_IP` |
| SSH | `ssh user@YOUR_SERVER_IP`（密码: <server_password>`） |
| 项目目录 | `/path/to/project/autoclaim` |
| 访问地址 | `https://YOUR_SERVER_IP:8443` |

### 8.2 部署命令

```bash
# 在本地（开发机），同步代码到服务器
rsync -avz --delete \
  --exclude 'node_modules' --exclude '.next' --exclude '.env' \
  --exclude 'uploads' --exclude 'src/generated' --exclude 'certs' \
  -e "ssh" /home/yao/autoclaim/ user@YOUR_SERVER_IP:/path/to/project/autoclaim/

# 在服务器上构建并启动
ssh user@YOUR_SERVER_IP
cd /path/to/project/autoclaim
docker compose --profile production up -d --build
```

### 8.3 首次部署

1. 创建 `.env`（参考 `SETUP.md`）
2. 生成证书：`./scripts/gen-cert.sh YOUR_SERVER_IP 8443`
3. 构建启动：`docker compose --profile production up -d --build`
4. 数据库迁移（容器启动时 `docker-start.sh` 会自动执行，如果失败手动执行）：
   ```bash
   for f in prisma/migrations/*/migration.sql; do
     docker compose exec -T db psql -U autoclaim -f - < $f
   done
   ```
5. 插入初始管理员：
   ```sql
   INSERT INTO employees (feishu_uid, name_en, is_admin, is_active)
   VALUES ('ou_xxx', 'Name', true, true);
   ```
6. 飞书后台配置重定向 URL：`https://YOUR_SERVER_IP:8443/api/auth/callback`

### 8.4 日常运维

```bash
# 查看日志
docker compose logs app --tail 50
docker compose logs -f app  # 实时

# 重启
docker compose --profile production restart

# 查看数据库
docker compose exec db psql -U autoclaim

# 手动同步审批
curl -sk -X POST https://YOUR_SERVER_IP:8443/api/approval/poll

# 查看 poller 日志
docker compose logs poller --tail 20
```

### 8.5 自签名证书

客户端需要信任 CA 证书（`certs/ca.crt`），否则浏览器报不安全：

| 系统 | 命令 |
|------|------|
| Ubuntu | `sudo cp ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates` |
| Chrome (Linux) | `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "AutoClaim CA" -i ca.crt` |
| macOS | `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt` |
| Windows | 双击 `ca.crt` → 安装 → 受信任的根证书颁发机构 |

---

## 九、开发环境配置

### 9.1 本地开发

```bash
# 前提：Node.js 22+, Docker

# 1. 启动数据库
docker compose up -d db

# 2. 安装依赖
npm install

# 3. 数据库迁移
npx prisma migrate dev

# 4. 生成 Prisma Client
npx prisma generate

# 5. 启动开发服务器
npm run dev
# → http://localhost:3000

# 6. 开发后门登录
# 浏览器访问 http://localhost:3000/api/auth/dev-login
```

### 9.2 本地 HTTPS（测试飞书 OAuth）

```bash
# 生成证书
./scripts/gen-cert.sh localhost 8443

# 启动 nginx 容器做 HTTPS 代理
docker run -d --name autoclaim-nginx-local \
  -p 8443:443 \
  -v $(pwd)/certs:/etc/nginx/certs:ro \
  -v $(pwd)/scripts/nginx-local.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine

# .env 设置
NEXT_PUBLIC_APP_URL="https://localhost:8443"

# 浏览器访问 https://localhost:8443
```

### 9.3 网络配置

开发机（Yuheng 的 Ubuntu 工作站）同时有有线和 WiFi，访问内网服务器需要路由：

```bash
# 有线网卡 enp2s0: 10.221.6.41/24
# WiFi wlp3s0: 172.25.1.19/24
# 服务器: YOUR_SERVER_IP

# 问题：默认路由走 WiFi，无法到达 10.221.x.x
# 修复（重启后失效）：
sudo ip route add 10.221.0.0/16 via 10.221.6.1 dev enp2s0
```

### 9.4 SSH 免密

```bash
sshpass -p '123' ssh-copy-id -o StrictHostKeyChecking=no user@YOUR_SERVER_IP
```

---

## 十、关键人员

| 角色 | 姓名 | 飞书 open_id | 系统角色 |
|------|------|-------------|---------|
| 开发者 | <developer_name> | `ou_your_open_id` | Admin |
| 超级管理员 | <super_admin_name>) | `ou_super_admin_open_id` | Super Admin（不可移除） |
| HR | <hr_name>) | `ou_hr_open_id` | Admin + 飞书审批人 |

---

## 十一、已知限制与后续建议

### 已知限制

1. **飞书审批定义不能通过 API 修改审批人类型**（如从 Personal 改为 Supervisor），只能重新创建或用 API 更新
2. **Bitable 连接器表需要给应用 bot 添加 Wiki 节点的协作者权限**才能用 tenant token 访问
3. **Prisma 7 的 standalone 模式**不包含完整 node_modules，跑 migrate 需要单独保留（见 Dockerfile 的 `node_modules_full`）
4. **自签名证书**需要每个客户端安装 CA，公司 IT 如果有内部 CA 可以替换
5. **数据库 `prisma migrate`** 在容器启动时可能因模块问题失败，SQL 可以直接执行

### 后续建议

1. **数据备份到飞书**：审批通过后自动写回 Bitable，作为数据冗余
2. **通知功能**：审批结果通过飞书 Bot 消息通知员工
3. **跨年处理**：目前每年独立计算，如果有跨年申请的第二年部分，需要在年初重新计算
4. **审批历史**：记录每次审批操作的完整日志（谁在什么时间通过了什么）
5. **导出格式**：目前导出 CSV，如需 Excel 格式（.xlsx）可引入 `xlsx` 库
