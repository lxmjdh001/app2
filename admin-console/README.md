# Admin Console (MUI Core)

技术栈：`React + Vite + TypeScript + MUI Core + React Query + Axios`

## 启动

```bash
cd /Users/chaoteng/Desktop/7c/100/postback-saas/admin-console
cp .env.example .env
npm install
npm run dev
```

打开：`http://127.0.0.1:5173`

## 登录

- 使用后端 `seed` 生成的 `admin_username / admin_password`
- 登录后系统保存 JWT，并按用户可访问 app 列表切换 `x-app-id`
- 所有管理请求走 `/admin/*`，由后端做 RBAC

## 页面

- 总览
- 追踪链接生成
- 平台配置（多像素管理：新增/启用/删除 pixel）
- 事件与队列
- 归因规则
- 事件映射
- 分析报表（SQL）
- 用户管理（仅 `admin` 可见）：创建用户、分配角色、禁用账号
- 配置文档（客户接入教程 + Android SDK 下载）
