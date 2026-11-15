# AGENTS.md — 项目修改准则

> 木搭图（Modatu）：Web 端铝型材家具设计工具。
> 供 AI Agent（Codex / Cursor / Jules / ZCode 等）与贡献者在修改本仓库前阅读并遵守。
> 术语以 [docs/terminology.md](docs/terminology.md) 为准；性能待修项见 [docs/performance-backlog.md](docs/performance-backlog.md)。

## 提交规范

- **Commit message 一律使用英文**（本项目规则，2026-11 起生效；不追溯改写已推送的历史）。
- 格式：`type: summary` — 祈使句、首字母小写、≤72 字符；需要展开动机/验收时写 body。
- type 取值：`feat` / `fix` / `perf` / `ux` / `docs` / `refactor` / `chore`。
- 示例：`fix(web): center extrude geometry so handles align to profile ends`。

## 语言约定

- UI 文案：简体中文。
- 代码注释：简体中文（简短、解释"为什么"）。
- 文档（docs/、README）：简体中文；术语表提供中英对照。

## 架构准则

- 所有编辑操作必须走 `@modatu/editor-state` 的受约束操作集（校验 + 撤销栈）；渲染层（Viewer3D）只读 store，不直接改模型。
- 渲染循环为按需渲染（render-on-demand）：任何场景内容变化必须触发 `Viewer3D` 的 `invalidate()`；不要恢复每帧无条件 `renderer.render`（空闲 CPU 会失控）。
- 型材挤出几何以原点为中心（min-corner 定位语义的前提）；改 `profile-geometry.ts` 前先读其注释与回归测试。
- React 组件文件**只导出组件**（Fast Refresh 要求）；共享常量/类型放 `stores/editor.ts` 等非组件模块（例：ORIENTATIONS）。
- 设计令牌集中在 `apps/web/src/styles.css`（Figma UI3：主色 #0D99FF、画布 #F5F5F5、圆角 2/6/10/13、阴影四档）；组件内不要硬编码颜色。
- `data-testid` 是 GUI 验收契约（如 `spec-card-*`、`placement-bar`、`parts-panel`），重构时保留。
- 主题（浅色/深色）属于用户设置页的能力，编辑器主界面不提供切换按钮。
- 键盘快捷键参考 Figma 惯例（V 选择、F2 按键徽章、Del 删除）；新增快捷键须同步 HelpModal 的「快捷键一览」。

## 修改流程

- 动代码前确认工作区干净、已读相关上下文；UI/交互改动先出设计稿确认再实现。
- 改动后必须验证：`apps/web` 下 `npx tsc --noEmit && npm test`；UI 改动在浏览器实测（dev:web 5173 + dev:server 3001）。
- **自动化验收优先用调试桥**：dev 构建下 `window.__modatu` 提供 `state() / place() / select() / align() / moveParts() / removeSelected() / undo() / gesture() / reloadCatalog() / reset()` 等确定性命令（直接操作 store，勿再模拟坐标点击）；真实指针事件仅用于验证指针交互本身（拖拽、hover、右键）。
- 修 bug 顺手补回归测试；修 UX 问题在 commit body 写明验收路径。

## 已知坑

- Vite HMR 长时间运行后可能失效（改了代码页面不更新）：重启 `dev:web`。
- Edge 原生鼠标手势在浏览器层拦截右键拖拽，网页无法用 API 禁用；应用层缓解（中键平移、离开守卫）见 commit 9fe21f2 与 HelpModal Q&A，用户侧解法是 `edge://settings/mouseGesture`。
- 高分屏注意 `renderer.setSize` 必须更新 CSS 尺寸（勿传 `updateStyle=false`），否则指针映射错位。
