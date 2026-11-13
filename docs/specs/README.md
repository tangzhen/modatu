# 木搭图（Modatu）Specs 索引

> 来源：`docs/requirements.md`（v0.1，需求梳理定稿）。
> 本项目暂无 issue tracker，spec 以文件形式发布，头部 `status: ready-for-agent` 即 triage 标签。

## Spec 列表与里程碑映射

| Spec | 标题 | 里程碑 |
|---|---|---|
| [spec-01-knowledge-base.md](./spec-01-knowledge-base.md) | 材料知识库与后台维护 | M1 |
| [spec-02-design-model.md](./spec-02-design-model.md) | 结构化设计模型、云端保存与版本历史 | M1（Schema）/ M4（保存与版本） |
| [spec-03-auth.md](./spec-03-auth.md) | 账号登录与用户管理 | M1 |
| [spec-04-3d-editor.md](./spec-04-3d-editor.md) | 3D 预览与受约束编辑器 | M2 |
| [spec-05-bom-export.md](./spec-05-bom-export.md) | BOM 清单生成与水印 PDF 导出 | M3 |
| [spec-06-ai-generation.md](./spec-06-ai-generation.md) | AI 生成与修改（BYOK，OpenAI 兼容） | M5 |

依赖顺序：spec-02（设计模型 Schema）是所有 spec 的共同上游；spec-04、05 依赖 spec-01（知识库）与 spec-02；spec-06 依赖 spec-01/02/04；spec-03 被所有需要登录的功能依赖。

## 测试接缝（Seams）

代码库为绿地项目，本组 spec 一并定义接缝。原则：**接缝越少越好，优先复用最高接缝**。

1. **设计模型 JSON Schema（核心接缝，唯一领域接缝）**
   所有模块（编辑器、AI、BOM、保存）只通过结构化设计模型 JSON 交互。Schema 校验器是该接缝的守门员：任何模块产出的模型必须通过同一校验。大多数测试围绕"给定合法/非法模型 JSON → 期望行为"展开。
2. **HTTP API 边界（NestJS controller）**
   认证、知识库、设计保存/版本走 HTTP API 测试（supertest 风格），不测内部实现。
3. **BOM 纯函数（design JSON → BOM 行 → PDF 字节）**
   无 IO、无状态的纯函数接缝，快照/性质测试最经济。
4. **LLM Adapter 接口（prompt+模型 → 模型 JSON / diff）**
   以假 LLM（canned response）做契约测试，绝不依赖真实网络。

3D 渲染本身不可单测：渲染层与模型/状态层解耦（见 spec-04），状态层用接缝 1 测试，渲染效果走人工可视化验收。

## 全局约定

- 单位统一 **mm**，切割精度 **0.5mm**（见 spec-05）。
- 设计数据仅云端保存，无本地导入/导出。
- 一期无邮件/商家发送、无充值、无手机 App。
