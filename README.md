# 木搭图（Modatu）

Web 端铝型材家具设计工具：自然语言/手动搭模型 → 3D 受约束编辑 → 导出带水印 BOM 清单。
Specs 见 `docs/specs/`，代码在 `src/app`（monorepo），`src/mobile` 为预留空目录。

## 一、启动数据库（Docker PostgreSQL）

> 前提：Docker 已就绪（Rancher Desktop 或 Docker Desktop，`docker version` 能输出即可）。

````powershell
# 1. 启动 PostgreSQL 16（首次执行一次；参数与项目默认配置严格对应）
# PowerShell 单行版（bash 多行续接符 \ 在 PowerShell 无效，勿粘多行）
docker run -d --name modatu-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=modatu -p 5432:5432 --restart unless-stopped postgres:16
````

```bash
# Git Bash 多行版（等价）
docker run -d \
  --name modatu-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=modatu \
  -p 5432:5432 \
  --restart unless-stopped \
  postgres:16

# 2. 等约 5 秒，验证数据库就绪（输出 accepting connections 即可）
docker exec modatu-pg pg_isready -U postgres

# 日常管理
docker stop modatu-pg     # 停止
docker start modatu-pg    # 再次启动
docker logs modatu-pg     # 看日志
docker rm -f modatu-pg    # 彻底删除容器（数据在容器卷里，慎用）
```

数据库连接默认值：`127.0.0.1:5432`，用户/密码/库名 = `postgres`/`postgres`/`modatu`。
不一致时用环境变量覆盖：`PGHOST` `PGPORT` `PGUSER` `PGPASSWORD` `PGDATABASE`。

## 二、初始化种子（管理员 + 初始知识库）

```bash
cd src/app
npm install          # 首次
npm run seed         # 幂等：管理员 admin/admin12345（ADMIN_PASSWORD 可覆盖）+ 型材/连接件/材质/规则
```

## 三、启动应用

```bash
cd src/app
npm run dev:server   # API → http://127.0.0.1:3001/api
npm run dev:web      # 前端 → http://localhost:5173（/api 代理到 3001）
```

浏览器打开 `http://localhost:5173`：

- 登录：`admin` / `admin12345`（或注册新用户）
- 隐藏登录页（线上测试通道，不在导航中）：`/login/hidden`
- dev 账密开关：`MODATU_DEV_PASSWORD_LOGIN=true` 启动服务端时生效

## 四、常用环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MODATU_DEV_PASSWORD_LOGIN` | false | dev 账密登录开关（隐藏页不受影响） |
| `MODATU_SECRET` | dev-secret-change-me | AI Key 静态加密主密钥（生产必改） |
| `MODATU_DB` | pg | `sqljs` = 内存库（免 Docker 演示用，重启丢数据） |
| `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | 127.0.0.1/5432/postgres/postgres/modatu | 数据库连接 |
| `ADMIN_USERNAME/ADMIN_PASSWORD` | admin/admin12345 | seed 管理员 |
| `MODATU_FONT_PATH` | 内置 assets/fonts | PDF 中文字体 |

## 五、测试

```bash
cd src/app && npm run test:packages      # 六个纯逻辑包 69 个测试
cd apps/server && npm test               # HTTP API 48 个（sqljs 内存库，无需 Docker）
cd apps/web && npm test                  # 前端 store 绑定 5 个
```

## 更多说明

- 架构与 spec 对应关系、实施边界：见 [src/app/README.md](src/app/README.md)
- 手机端预留目录：见 [src/mobile/README.md](src/mobile/README.md)
