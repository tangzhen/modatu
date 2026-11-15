# 性能问题待修清单（性能优化 Backlog）

> 2026-11-14 排查结论：在 9800X3D + 5070Ti、场景仅两根型材的情况下，空闲 CPU 高达 ~40%。
> **根因 1（空闲 CPU）已于 2026-11-14 修复**（按需渲染 + pixelRatio 上限，见 `Viewer3D.tsx`）。
> 以下问题**尚未修复**，按优先级排期。

## P1：拖拽管道 — 每次 pointermove 走一遍重管道（拖拽卡顿根因）

**位置**：`apps/web/src/components/Viewer3D.tsx`（onPointerMove）→ `apps/web/src/stores/editor.ts`（applyOp）→ `packages/editor-state/src/index.ts`。

**现状**：游戏鼠标 pointermove 事件可达 1000Hz。拖拽移动/调长时，每个 pointermove 事件触发一整条链：

1. `applyOp` → `pushUndo()`：`JSON.parse(JSON.stringify(model))` 全模型深克隆（editor-state `index.ts:128`）
2. `applyOp` → `set({ model: editor.getModel() })`：`getModel()` 又一次全模型深克隆（editor-state `index.ts:100`）
3. `scheduleSave()`：`set({ saveStatus })` 第二次 zustand 更新
4. `EditorPage` / `PartsPanel` / `PropertiesPanel` 全部 re-render（三者均 `useEditor()` 无 selector 订阅整个 store）
5. `Viewer3D` 模型重建 effect（依赖 `[model, catalog, selectedId]`）：`partGroup.clear()` 后全部 mesh 重建
6. 渲染一帧

即：1 秒拖拽 ≈ 2000+ 次全模型 JSON 深克隆 + 1000 次 React 整页 re-render + 1000 次场景重建。当前部件少时勉强可用，部件增多后拖拽必然卡顿。

**目标方案（CAD 标准）**：拖拽期间 3D 层本地预览——只更新对应 mesh 的 transform（`PartRecord` 已缓存 dims/quaternion），`pointerup` 才提交一次 op（一条撤销记录、一次 store 更新、一次 re-render）。

**附带 bug**：`Viewer3D.tsx` 顶部注释写明调长"一次手势一条撤销记录"，但现实现每次 pointermove 都 `pushUndo` 一条——拖 1 秒即填满撤销栈（`MAX_HISTORY = 100`），此后按一次撤销只回退 10mm。目标方案落地后此 bug 自动消失；若先走简化路线（EditorState 内合并连续同 id 操作），需显式处理。

**验收标准**：
- 一次拖拽手势 = 1 条撤销记录、1 次模型深克隆、1 次 React re-render
- 50+ 部件场景拖拽不丢帧（DevTools Performance 无长任务）

## P2：React 订阅粒度 — useEditor() 无 selector 全量订阅

**位置**：`apps/web/src/pages/EditorPage.tsx`、`apps/web/src/components/PartsPanel.tsx`（两处）、`apps/web/src/components/PropertiesPanel.tsx`。

**现状**：均 `useEditor()` 解构整包，store 任何字段变化（含 saveStatus 每次翻转）都触发整页 re-render。

**目标**：改用 zustand selector 按需订阅（`useEditor((s) => s.model)` 等）；`saveStatus` 单独订阅，避免保存状态翻转带动 3D 侧全量重渲。

**验收标准**：自动保存触发时不再引发 Viewer3D 组件 re-render（React Profiler 验证）。

## P3：getModel() 克隆成本与 partGroup 全量重建

**位置**：`packages/editor-state/src/index.ts`（getModel/pushUndo/undo/redo 共 6 处 `JSON.parse(JSON.stringify(...))`）；`apps/web/src/components/Viewer3D.tsx` 模型重建 effect。

**现状**：
- 所有读模型路径都深克隆。可在 `commit()` 时克隆一次供外部引用，内部操作直接改私有 model，读接口去掉克隆。
- Viewer3D 的模型 effect 按 `[model, catalog, selectedId]` 全量重建。可改为按部件 id diff：新增建 mesh、删除移除、其余只更新 transform/材质。

**验收标准**：单次 op 的 JS 主线程耗时 < 2ms（100 部件场景）。

## 备注

- P1 与 P3 有耦合：P1 的"pointerup 才提交"落地后，拖拽路径上的克隆次数大幅下降，P3 的克隆优化受益面变窄但仍对键盘快捷键、AI 应用、自动保存等路径有效。
- 已修复项（勿重复排期）：Viewer3D 按需渲染（render-on-demand）、`setPixelRatio` 上限 2（`apps/web/src/components/Viewer3D.tsx`，2026-11-14）。
