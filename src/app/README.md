# 木搭图（Modatu）实现说明

> 依据 `docs/specs/` 六个 spec 实施的第一期代码（M1–M5 全链路骨架）。
> 代码位于 `src/app`；`src/mobile` 为预留空目录（见其 README）。

## 结构

```
src/app/
├─ packages/                     # 纯逻辑包（spec 定义的核心测试接缝）
│  ├─ catalog/        # 知识库类型、兼容矩阵查询、初始种子数据（spec-01）
│  ├─ design-model/   # 设计模型 Schema + 知识库引用校验 + diff（spec-02 核心接缝）
│  ├─ bom/            # BOM 生成纯函数：design JSON → 清单行（spec-05 接缝 3）
│  ├─ safety-rules/   # 规则化安全提示求值（spec-01 数据 / spec-04 编辑器提示）
│  ├─ editor-state/   # 受约束编辑器模型状态层 + 撤销栈（spec-04，无渲染依赖）
│  └─ llm-adapter/    # LLM 统一适配器接口 + OpenAI 兼容实现（spec-06 接缝 4）
├─ apps/
│  ├─ server/         # NestJS + TypeORM：auth/目录/设计版本/AI/PDF 导出 + 后台
│  └─ web/            # React + Vite + Three.js：编辑器、后台、登录、AI 设置
└─ src/mobile → （见 /src/mobile）
```

## 快速开始

```bash
cd src/app
npm install

# 1) 配置 PostgreSQL（或先用内存库体验）
#    默认连 127.0.0.1:5432/modatu，可用环境变量 PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE 覆盖
#    无 PG 时可用内存库启动（数据不持久）：MODATU_DB=sqljs

# 2) 建库 + 种子（管理员 + 初始知识库）
npm run seed        # 需要已创建 PGDATABASE；管理员账号默认 admin/admin12345（ADMIN_PASSWORD 可覆盖）

# 3) 启动
npm run dev:server  # API :3001
npm run dev:web     # 前端 :5173（/api 代理到 3001）
```

## 关键运行开关（spec-03/06）

| 环境变量 | 说明 |
|---|---|
| `MODATU_DEV_PASSWORD_LOGIN` | dev 账密登录开关（`true`/`false`，生产应为 false） |
| `/login/hidden` | 隐藏登录页固定路由（不受 dev flag 影响，线上测试通道，勿"修复"） |
| `MODATU_SECRET` | AES-256-GCM 主密钥（用户 AI Key 静态加密），生产必改 |
| `MODATU_DB` | `pg`（默认）/ `sqljs`（内存，测试用） |
| `MODATU_FONT_PATH` | PDF 中文字体路径；缺省用 `apps/server/assets/fonts/NotoSansSC-Regular.ttf` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | seed 管理员账号 |

## 测试

```bash
npm run test:packages   # 六包纯逻辑测试（69 个）
cd apps/server && npm test   # HTTP API 测试 48 个（sqljs 内存库 + supertest，spec 定义接缝 2）
cd apps/web && npm test      # store ↔ 状态层绑定测试（5 个）
```

测试接缝与 spec 对应：
1. 设计模型 Schema —— `packages/design-model/tests`（合法/非法 fixture、精度、引用）
2. HTTP API 边界 —— `apps/server/test/*.e2e-spec.ts`（不测内部 SQL/ORM）
3. BOM 纯函数 —— `packages/bom/tests`（合并计数、系数推导、缺失兼容件显式标记）
4. LLM Adapter —— `packages/llm-adapter/tests` + `apps/server/test/ai.e2e-spec.ts`（canned 假 LLM，绝不连网）

## 一期范围对应

- **spec-01** 知识库：四类实体 CRUD/软停用、只读 `/api/catalog/*`、后台搜索
- **spec-02** 设计模型/保存/版本：Schema+引用校验、乐观锁 409、版本前向追加与回退、软删除
- **spec-03** 登录：dev 账密（flag）、隐藏登录页、微信适配器（501 暂未开通）、bcrypt、httpOnly Cookie 会话、封禁
- **spec-04** 编辑器：Three.js 预览（真实截面/厚度）、受约束操作、撤销栈、安全提示、拾取/拖拽
- **spec-05** BOM：纯函数生成、预览、水印 PDF（用户 ID+昵称+时间戳斜向平铺 + 页脚标识）
- **spec-06** AI：BYOK（加密存储/掩码回显）、生成/修改、系统侧 diff 预览、未满足项、失败重试链

## 已知边界（实施决策记录）

- PG 生产库 `synchronize: true` 仅限开发期；上线前应换 migration。
- 版本快照全量存储 JSON（一期数据量小）；AI prompt 模板为起步版本，实施期迭代。
- 三维渲染为盒体近似截面（真实宽高/厚度），槽口细节与实例化渲染为性能储备项。
- 微信扫码登录为适配器占位（501），资质就绪后在 `WechatQrLoginAdapter` 内接入。
