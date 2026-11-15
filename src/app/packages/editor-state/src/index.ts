import type { CatalogSnapshot } from '@modatu/catalog';
import { findFinish } from '@modatu/catalog';
import {
  diffModels,
  parseDesign,
  snapToHalfMm,
  validateAgainstCatalog,
  validateSchema,
  type Axis,
  type DesignModel,
  type Plane,
  type ProfilePart,
  type Vec3,
} from '@modatu/design-model';

/**
 * 受约束编辑器模型状态层（spec-04）。
 *
 * 关键决策：纯逻辑、无 Three.js 依赖。渲染层通过本抽象消费模型状态；
 * 所有编辑操作是"有限且固定"的受约束集合，非法操作被直接拒绝并给出原因，
 * 编辑器永远产不出违反 Schema 或知识库约束的模型。
 *
 * 撤销/重做是编辑会话内行为（命令栈）；云端版本历史是持久行为（spec-02），两者互不相干。
 */

export interface OpResult {
  ok: boolean;
  /** 拒绝原因（面向用户展示） */
  reason?: string;
  issues?: Array<{ path: string; message: string }>;
}

export interface ProfileInput {
  specCode: string;
  cutLength: number;
  position: Vec3;
  orientation: Axis;
  /** 颜色（知识库 ProfileFinish.id）；缺省用知识库中的本色/首个启用颜色 */
  finishId?: string;
}

export interface PanelInput {
  materialId: string;
  thickness: number;
  width: number;
  height: number;
  position: Vec3;
  plane: Plane;
}

export interface EditorStateEvents {
  change: void;
}

const MAX_HISTORY = 100;

let idCounter = 0;
/** 生成稳定、可读的部件 id（编辑器创建的部件）。 */
export function newPartId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/** 重置 id 计数器（仅测试用）。 */
export function __resetPartIdCounter(): void {
  idCounter = 0;
}

export class EditorState {
  private model: DesignModel;
  private readonly catalog: CatalogSnapshot;
  private undoStack: DesignModel[] = [];
  private redoStack: DesignModel[] = [];
  private listeners = new Set<() => void>();
  private lastChangeDescription = '';
  /** 手势合并（拖拽/调长）：开始时的模型快照；期间的操作不再逐条入栈，结束时合并为一条。 */
  private gestureStartModel: DesignModel | null = null;
  private gestureChanged = false;

  constructor(initial: DesignModel, catalog: CatalogSnapshot) {
    const check = validateSchema(initial);
    if (!check.ok) {
      throw new Error(`初始模型非法: ${JSON.stringify(check.issues.slice(0, 3))}`);
    }
    this.model = JSON.parse(JSON.stringify(initial)) as DesignModel;
    this.catalog = catalog;
  }

  /* ------------------------------- 订阅 ------------------------------- */

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /* ------------------------------ 读接口 ------------------------------ */

  getModel(): DesignModel {
    return JSON.parse(JSON.stringify(this.model)) as DesignModel;
  }

  getPart(id: string): ProfilePart | undefined {
    return this.model.profiles.find((p) => p.id === id);
  }

  describeLastChange(): string {
    return this.lastChangeDescription;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /* ------------------------------ 撤销栈 ------------------------------ */

  private commit(description: string): void {
    this.lastChangeDescription = description;
    this.redoStack = [];
    this.emit();
  }

  private pushUndo(): DesignModel {
    // 手势期间不逐条入栈：起始快照由 beginGesture 持有，endGesture 合并为一条
    if (this.gestureStartModel) {
      this.gestureChanged = true;
      return this.model;
    }
    this.undoStack.push(JSON.parse(JSON.stringify(this.model)));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    return this.model;
  }

  /** 手势开始（拖拽移动/调长）：记录起始快照，期间所有操作合并为一条撤销记录。 */
  beginGesture(): void {
    if (this.gestureStartModel) return;
    this.gestureStartModel = JSON.parse(JSON.stringify(this.model)) as DesignModel;
    this.gestureChanged = false;
  }

  /** 手势结束：模型有变化时压入起始快照（撤销即回到起始位置）；无变化（纯点击）则丢弃。 */
  endGesture(): void {
    const start = this.gestureStartModel;
    this.gestureStartModel = null;
    if (!start) return;
    if (!this.gestureChanged) return;
    this.undoStack.push(start);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.commit(this.lastChangeDescription);
  }

  undo(): OpResult {
    const prev = this.undoStack.pop();
    if (!prev) return { ok: false, reason: '没有可撤销的操作' };
    this.redoStack.push(JSON.parse(JSON.stringify(this.model)));
    this.model = prev;
    this.lastChangeDescription = '撤销';
    this.emit();
    return { ok: true };
  }

  redo(): OpResult {
    const next = this.redoStack.pop();
    if (!next) return { ok: false, reason: '没有可重做的操作' };
    this.undoStack.push(JSON.parse(JSON.stringify(this.model)));
    this.model = next;
    this.lastChangeDescription = '重做';
    this.emit();
    return { ok: true };
  }

  /* --------------------------- 受约束操作集 --------------------------- */

  private sanitizePosition(position: Vec3): Vec3 {
    return { x: snapToHalfMm(position.x), y: snapToHalfMm(position.y), z: snapToHalfMm(position.z) };
  }

  /** 全量替换模型（AI 应用 / 回退入口）：整体校验，不通过则拒绝且不改变现状。 */
  replaceModel(next: DesignModel, description: string): OpResult {
    const schemaCheck = parseDesign(next);
    if (!schemaCheck.ok || !schemaCheck.design) {
      return { ok: false, reason: '模型未通过 Schema 校验', issues: schemaCheck.issues };
    }
    const catalogCheck = validateAgainstCatalog(schemaCheck.design, this.catalog);
    if (!catalogCheck.ok) {
      return { ok: false, reason: '模型引用了无效的知识库条目', issues: catalogCheck.issues };
    }
    this.pushUndo();
    this.model = schemaCheck.design;
    this.commit(description);
    return { ok: true };
  }

  addProfile(input: ProfileInput): OpResult {
    const spec = this.catalog.profiles.find((p) => p.code === input.specCode && p.enabled);
    if (!spec) return { ok: false, reason: `规格 ${input.specCode} 不存在或已停用` };
    const cutLength = snapToHalfMm(input.cutLength);
    if (cutLength <= 0) return { ok: false, reason: '切割长度必须为正数' };
    if (cutLength < spec.minCutLength || cutLength > spec.maxCutLength) {
      return {
        ok: false,
        reason: `切割长度 ${cutLength}mm 超出 ${spec.code} 允许范围 [${spec.minCutLength}, ${spec.maxCutLength}]`,
      };
    }
    const finishId = input.finishId ?? this.defaultFinishId();
    if (finishId !== undefined && !findFinish(this.catalog, finishId)) {
      return { ok: false, reason: `颜色 ${finishId} 不存在或已停用` };
    }
    const part: ProfilePart = {
      id: newPartId('pr'),
      specCode: spec.code,
      cutLength,
      position: this.sanitizePosition(input.position),
      orientation: input.orientation,
      ...(finishId !== undefined ? { finishId } : {}),
      connections: [],
    };
    this.pushUndo();
    this.model.profiles.push(part);
    this.commit(`添加型材 ${spec.code} @ ${cutLength}mm`);
    return { ok: true };
  }

  /** 更换型材颜色：颜色条目必须存在且启用。 */
  setProfileFinish(id: string, finishId: string): OpResult {
    const part = this.model.profiles.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    const finish = findFinish(this.catalog, finishId);
    if (!finish) return { ok: false, reason: `颜色 ${finishId} 不存在或已停用` };
    this.pushUndo();
    part.finishId = finish.id;
    this.commit(`颜色改为「${finish.name}」`);
    return { ok: true };
  }

  /** 默认颜色：优先本色代号，其次知识库首个启用颜色。 */
  private defaultFinishId(): string | undefined {
    const finishes = this.catalog.finishes ?? [];
    return finishes.find((f) => f.code === 'natural')?.id ?? finishes[0]?.id;
  }

  removeProfile(id: string): OpResult {
    const part = this.model.profiles.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    this.pushUndo();
    this.model.profiles = this.model.profiles.filter((p) => p.id !== id);
    // 清理指向被删部件的连接
    for (const p of this.model.profiles) {
      p.connections = p.connections.filter((c) => c.targetPartId !== id);
    }
    this.commit(`删除型材 ${part.id}`);
    return { ok: true };
  }

  moveProfile(id: string, position: Vec3): OpResult {
    const part = this.model.profiles.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    this.pushUndo();
    part.position = this.sanitizePosition(position);
    this.commit(`移动部件 ${id}`);
    return { ok: true };
  }

  /** 多部件移动（多选拖拽 / 对齐）：一次操作一条撤销记录。 */
  moveParts(updates: Array<{ id: string; position: Vec3 }>): OpResult {
    if (updates.length === 0) return { ok: false, reason: '没有可移动的部件' };
    const profiles = new Map(this.model.profiles.map((p) => [p.id, p] as const));
    const panels = new Map(this.model.panels.map((p) => [p.id, p] as const));
    for (const u of updates) {
      if (!profiles.has(u.id) && !panels.has(u.id)) {
        return { ok: false, reason: `部件 ${u.id} 不存在` };
      }
    }
    this.pushUndo();
    for (const u of updates) {
      const pos = this.sanitizePosition(u.position);
      const profile = profiles.get(u.id);
      if (profile) profile.position = pos;
      const panel = panels.get(u.id);
      if (panel) panel.position = pos;
    }
    this.commit(`移动 ${updates.length} 个部件`);
    return { ok: true };
  }

  /** 多部件删除（多选 + Delete）：一次操作一条撤销记录，并清理指向被删部件的连接。 */
  removeParts(ids: string[]): OpResult {
    const idSet = new Set(ids);
    const exists =
      this.model.profiles.some((p) => idSet.has(p.id)) || this.model.panels.some((p) => idSet.has(p.id));
    if (!exists) return { ok: false, reason: '部件不存在' };
    this.pushUndo();
    this.model.profiles = this.model.profiles.filter((p) => !idSet.has(p.id));
    for (const p of this.model.profiles) {
      p.connections = p.connections.filter((c) => !idSet.has(c.targetPartId));
    }
    this.model.panels = this.model.panels.filter((p) => !idSet.has(p.id));
    this.commit(`删除 ${ids.length} 个部件`);
    return { ok: true };
  }

  resizeProfile(id: string, cutLength: number): OpResult {
    const part = this.model.profiles.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    const spec = this.catalog.profiles.find((p) => p.code === part.specCode && p.enabled);
    if (!spec) return { ok: false, reason: `规格 ${part.specCode} 不存在或已停用` };
    const length = snapToHalfMm(cutLength);
    if (length <= 0) return { ok: false, reason: '切割长度必须为正数' };
    if (length < spec.minCutLength || length > spec.maxCutLength) {
      return {
        ok: false,
        reason: `切割长度 ${length}mm 超出 ${spec.code} 允许范围 [${spec.minCutLength}, ${spec.maxCutLength}]`,
      };
    }
    this.pushUndo();
    part.cutLength = length;
    this.commit(`调整切割长度为 ${length}mm`);
    return { ok: true };
  }

  /** 3D 调长手柄/快捷键：一次手势同时更新切割长度与位置（保持另一端锚定），单条撤销记录。 */
  setProfileExtent(id: string, cutLength: number, position: Vec3): OpResult {
    const part = this.model.profiles.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    const spec = this.catalog.profiles.find((p) => p.code === part.specCode && p.enabled);
    if (!spec) return { ok: false, reason: `规格 ${part.specCode} 不存在或已停用` };
    const length = snapToHalfMm(cutLength);
    if (length <= 0) return { ok: false, reason: '切割长度必须为正数' };
    if (length < spec.minCutLength || length > spec.maxCutLength) {
      return {
        ok: false,
        reason: `切割长度 ${length}mm 超出 ${spec.code} 允许范围 [${spec.minCutLength}, ${spec.maxCutLength}]`,
      };
    }
    this.pushUndo();
    part.cutLength = length;
    part.position = this.sanitizePosition(position);
    this.commit(`调整型材 ${id} 为 ${length}mm`);
    return { ok: true };
  }

  /** 更换型材规格：校验新规格启用、长度范围，且存量连接仍兼容。 */
  changeSpec(id: string, specCode: string): OpResult {
    const part = this.model.profiles.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    const spec = this.catalog.profiles.find((p) => p.code === specCode && p.enabled);
    if (!spec) return { ok: false, reason: `规格 ${specCode} 不存在或已停用` };
    if (part.cutLength < spec.minCutLength || part.cutLength > spec.maxCutLength) {
      return {
        ok: false,
        reason: `当前切割长度 ${part.cutLength}mm 超出新规格 ${spec.code} 允许范围 [${spec.minCutLength}, ${spec.maxCutLength}]，请先调整长度`,
      };
    }
    // 连接兼容性检查（换规格后存量连接可能失效）
    for (const c of part.connections) {
      const target = this.model.profiles.find((q) => q.id === c.targetPartId);
      if (target && !this.hasCompat(spec.code, target.specCode, c.connectorId)) {
        return {
          ok: false,
          reason: `与部件 ${target.id}（${target.specCode}）的连接件在新规格 ${spec.code} 下不兼容，请先移除该连接`,
        };
      }
    }
    this.pushUndo();
    part.specCode = spec.code;
    this.commit(`更换规格为 ${spec.code}`);
    return { ok: true };
  }

  addConnection(profileId: string, connectorId: string, targetPartId: string): OpResult {
    const from = this.model.profiles.find((p) => p.id === profileId);
    if (!from) return { ok: false, reason: '部件不存在' };
    const target = this.model.profiles.find((p) => p.id === targetPartId);
    if (!target) return { ok: false, reason: '连接目标不存在' };
    if (profileId === targetPartId) return { ok: false, reason: '连接不能指向自身' };
    if (from.connections.some((c) => c.connectorId === connectorId && c.targetPartId === targetPartId)) {
      return { ok: false, reason: '该连接已存在' };
    }
    if (!this.hasCompat(from.specCode, target.specCode, connectorId)) {
      return {
        ok: false,
        reason: `所选连接件不兼容 ${from.specCode} × ${target.specCode}`,
      };
    }
    this.pushUndo();
    from.connections.push({ connectorId, targetPartId });
    this.commit(`添加连接 ${from.id} → ${target.id}`);
    return { ok: true };
  }

  removeConnection(profileId: string, connectorId: string, targetPartId: string): OpResult {
    const from = this.model.profiles.find((p) => p.id === profileId);
    if (!from) return { ok: false, reason: '部件不存在' };
    const before = from.connections.length;
    from.connections = from.connections.filter(
      (c) => !(c.connectorId === connectorId && c.targetPartId === targetPartId),
    );
    if (from.connections.length === before) return { ok: false, reason: '连接不存在' };
    this.commit(`移除连接 ${profileId} → ${targetPartId}`);
    return { ok: true };
  }

  addPanel(input: PanelInput): OpResult {
    const material = this.catalog.panelMaterials.find((m) => m.id === input.materialId && m.enabled);
    if (!material) return { ok: false, reason: `材质 ${input.materialId} 不存在或已停用` };
    const thickness = snapToHalfMm(input.thickness);
    if (!material.thicknesses.includes(thickness)) {
      return {
        ok: false,
        reason: `厚度 ${thickness}mm 不在材质「${material.name}」常用厚度 [${material.thicknesses.join(', ')}] 内`,
      };
    }
    const width = snapToHalfMm(input.width);
    const height = snapToHalfMm(input.height);
    if (width <= 0 || height <= 0) return { ok: false, reason: '板面尺寸必须为正数' };
    this.pushUndo();
    this.model.panels.push({
      id: newPartId('pn'),
      materialId: material.id,
      thickness,
      width,
      height,
      position: this.sanitizePosition(input.position),
      plane: input.plane,
    });
    this.commit(`添加封板 ${material.name} ${width}×${height}`);
    return { ok: true };
  }

  removePanel(id: string): OpResult {
    const part = this.model.panels.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    this.pushUndo();
    this.model.panels = this.model.panels.filter((p) => p.id !== id);
    this.commit(`删除封板 ${id}`);
    return { ok: true };
  }

  movePanel(id: string, position: Vec3): OpResult {
    const part = this.model.panels.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    this.pushUndo();
    part.position = this.sanitizePosition(position);
    this.commit(`移动部件 ${id}`);
    return { ok: true };
  }

  resizePanel(
    id: string,
    dims: { thickness?: number; width?: number; height?: number },
  ): OpResult {
    const part = this.model.panels.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    const material = this.catalog.panelMaterials.find(
      (m) => m.id === part.materialId && m.enabled,
    );
    if (!material) return { ok: false, reason: `材质 ${part.materialId} 不存在或已停用` };
    const width = dims.width !== undefined ? snapToHalfMm(dims.width) : part.width;
    const height = dims.height !== undefined ? snapToHalfMm(dims.height) : part.height;
    const thickness = dims.thickness !== undefined ? snapToHalfMm(dims.thickness) : part.thickness;
    if (width <= 0 || height <= 0) return { ok: false, reason: '板面尺寸必须为正数' };
    if (!material.thicknesses.includes(thickness)) {
      return {
        ok: false,
        reason: `厚度 ${thickness}mm 不在材质「${material.name}」常用厚度 [${material.thicknesses.join(', ')}] 内`,
      };
    }
    this.pushUndo();
    part.width = width;
    part.height = height;
    part.thickness = thickness;
    this.commit(`调整封板尺寸 ${width}×${height}×${thickness}`);
    return { ok: true };
  }

  setPanelMaterial(id: string, materialId: string): OpResult {
    const part = this.model.panels.find((p) => p.id === id);
    if (!part) return { ok: false, reason: '部件不存在' };
    const material = this.catalog.panelMaterials.find((m) => m.id === materialId && m.enabled);
    if (!material) return { ok: false, reason: `材质 ${materialId} 不存在或已停用` };
    if (!material.thicknesses.includes(part.thickness)) {
      return {
        ok: false,
        reason: `当前厚度 ${part.thickness}mm 不在新材质「${material.name}」常用厚度内，请先调整厚度`,
      };
    }
    this.pushUndo();
    part.materialId = material.id;
    this.commit(`更换材质为 ${material.name}`);
    return { ok: true };
  }

  setModelName(name: string): OpResult {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 80) {
      return { ok: false, reason: '名称长度须在 1-80 字符之间' };
    }
    this.pushUndo();
    this.model.meta.name = trimmed;
    this.commit(`重命名为「${trimmed}」`);
    return { ok: true };
  }

  /** 与给定模型计算 diff（供保存摘要与 AI diff 预览）。 */
  diffAgainst(other: DesignModel) {
    return diffModels(other, this.model);
  }

  /* ------------------------------ 内部 ------------------------------ */

  private hasCompat(codeA: string, codeB: string, connectorId: string): boolean {
    return this.catalog.compatibilities.some(
      (c) =>
        c.connectorId === connectorId &&
        ((c.profileCodeA === codeA && c.profileCodeB === codeB) ||
          (c.profileCodeA === codeB && c.profileCodeB === codeA)) &&
        this.catalog.connectors.some((cn) => cn.id === connectorId && cn.enabled),
    );
  }
}
