# postback-saas (TikTok / Facebook 回传 SaaS)

已实现：
- 点击采集 + 302 跳转（`ttclid/fbc/click_id`）
- API/Worker 分离
- 归因规则版本化 + SDK 统一协议（`event_uid/oa_uid/ifa`）
- ClickHouse 分析层 + 可配置 SQL
- 中后台（MUI Core）
- 账号密码登录（JWT）+ 多用户 RBAC（`admin/operator/analyst/viewer`）
- 用户管理（创建用户、分配角色、禁用账号）
- 多像素回传（一个 App 可配置多个 Pixel）
- 配置文档菜单（客户接入教程 + Android SDK 下载）

## 1) 后端启动

```bash
cd /Users/chaoteng/Desktop/7c/100/postback-saas
cp .env.example .env
npm install
npm run migrate
npm run seed -- --name your-app --admin-username admin --admin-password admin123456
```

启动 API：
```bash
npm run start:api
```

启动 worker（另一个终端）：
```bash
npm run start:worker
```

## 2) 中后台启动（MUI）

```bash
cd /Users/chaoteng/Desktop/7c/100/postback-saas/admin-console
cp .env.example .env
npm install
npm run dev
```

打开：`http://127.0.0.1:5173`

登录使用 seed 输出的账号密码（如 `admin/admin123456`）。

## 3) 鉴权模型

- `POST /auth/login`：用户名密码换 JWT
- `GET /auth/me`：获取当前用户 + app 角色

管理台 API 路径：`/admin/*`（JWT + `x-app-id`）

投放/SDK 上报路径：`/api/*`（`app_key`）

## 4) 多像素配置（一个 App 多 Pixel）

- `GET /admin/platform-pixels`：查看当前 app 的像素列表
- `POST /admin/platform-pixels/:platform`：新增像素（平台为 `facebook/tiktok`）
- `PATCH /admin/platform-pixels/:pixelId`：更新像素配置（如启用/停用）
- `DELETE /admin/platform-pixels/:pixelId`：删除像素

行为说明：
- 同一 App / 平台可配置多个像素
- 事件入队时按像素展开为多条 `postback_jobs`（每个像素一条）
- 如果某平台没有像素列表，则回退到旧的 `platform_configs` 单配置

## 5) 用户管理 API（admin）

- `GET /admin/users`：查看当前 app 用户与角色
- `POST /admin/users`：创建用户并分配角色（已存在用户则更新密码并激活）
- `PATCH /admin/users/:userId/role`：修改用户在当前 app 的角色
- `PATCH /admin/users/:userId/status`：启用/禁用账号（不可禁用 super admin）

## 6) P0 点击采集

### 广告链接点击入口

```bash
curl -i "http://localhost:8088/track/click?app_key=<APP_KEY>&redirect=https%3A%2F%2Fexample.com%2Flanding&ttclid=TTC123&fbc=fb.1.abc&campaign=NEX855_VTK&append_click_id=true"
```

### S2S 点击落库

```bash
curl -X POST http://localhost:8088/track/click \
  -H 'Content-Type: application/json' \
  -d '{
    "app_key":"<APP_KEY>",
    "redirect":"https://example.com/landing",
    "ttclid":"TTC123",
    "fbc":"fb.1.abc",
    "campaign":"NEX855_VTK"
  }'
```

## 7) 事件上报（SDK 协议）

推荐事件名：`install_open`（安装打开）、`register`、`ftd`、`deposit`。


```bash
curl -X POST http://localhost:8088/api/sdk/events \
  -H 'Content-Type: application/json' \
  -d '{
    "app_key":"<APP_KEY>",
    "event_name":"ftd",
    "event_uid":"evt-10001",
    "oa_uid":"oa-u-888",
    "ifa":"gaid-xxx",
    "destinations":["facebook","tiktok"],
    "user_data":{"ttclid":"TTC123","fbc":"fb.1.abc"},
    "custom_data":{"value":50,"currency":"USD"}
  }'
```

## 8) RBAC 角色说明

- `viewer`：只读（队列/映射/配置查看）
- `analyst`：只读 + 分析查询
- `operator`：可发事件、改映射
- `admin`：可改规则、SQL、平台配置、用户授权

## 9) ClickHouse（可选）

在 `.env` 打开：
```bash
CLICKHOUSE_ENABLED=true
CLICKHOUSE_URL=http://127.0.0.1:8123
CLICKHOUSE_DATABASE=postback_analytics
```
