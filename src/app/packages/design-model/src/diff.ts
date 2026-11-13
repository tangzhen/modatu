import type { DesignModel, PanelPart, ProfilePart, Vec3 } from './schema';

/**
 * 设计模型 diff（spec-06：系统侧由新旧模型对比得出，不信任 LLM 自报 diff；
 * 保证 diff 与实际应用结果一一对应）。
 */

export type PartKind = 'profile' | 'panel';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface AddedPart {
  kind: 'added';
  partKind: PartKind;
  id: string;
  label: string;
}
export interface RemovedPart {
  kind: 'removed';
  partKind: PartKind;
  id: string;
  label: string;
}
export interface ChangedPart {
  kind: 'changed';
  partKind: PartKind;
  id: string;
  label: string;
  changes: FieldChange[];
}

export type ModelDiffEntry = AddedPart | RemovedPart | ChangedPart;

export interface ModelDiff {
  nameChanged: boolean;
  entries: ModelDiffEntry[];
  isEmpty: boolean;
}

function labelOfProfile(p: ProfilePart): string {
  return `型材 ${p.specCode} @ ${p.cutLength}mm`;
}
function labelOfPanel(p: PanelPart): string {
  return `封板 ${p.materialId} ${p.width}×${p.height}`;
}

function vecEquals(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

function compareProfile(before: ProfilePart, after: ProfilePart): FieldChange[] {
  const changes: FieldChange[] = [];
  if (before.specCode !== after.specCode)
    changes.push({ field: 'specCode', before: before.specCode, after: after.specCode });
  if (before.cutLength !== after.cutLength)
    changes.push({ field: 'cutLength', before: before.cutLength, after: after.cutLength });
  if (before.orientation !== after.orientation)
    changes.push({ field: 'orientation', before: before.orientation, after: after.orientation });
  if (!vecEquals(before.position, after.position))
    changes.push({ field: 'position', before: before.position, after: after.position });
  if (JSON.stringify(before.connections) !== JSON.stringify(after.connections))
    changes.push({ field: 'connections', before: before.connections, after: after.connections });
  return changes;
}

function comparePanel(before: PanelPart, after: PanelPart): FieldChange[] {
  const changes: FieldChange[] = [];
  if (before.materialId !== after.materialId)
    changes.push({ field: 'materialId', before: before.materialId, after: after.materialId });
  if (before.thickness !== after.thickness)
    changes.push({ field: 'thickness', before: before.thickness, after: after.thickness });
  if (before.width !== after.width)
    changes.push({ field: 'width', before: before.width, after: after.width });
  if (before.height !== after.height)
    changes.push({ field: 'height', before: before.height, after: after.height });
  if (before.plane !== after.plane)
    changes.push({ field: 'plane', before: before.plane, after: after.plane });
  if (!vecEquals(before.position, after.position))
    changes.push({ field: 'position', before: before.position, after: after.position });
  return changes;
}

/** 计算新旧模型的完整 diff。 */
export function diffModels(before: DesignModel, after: DesignModel): ModelDiff {
  const entries: ModelDiffEntry[] = [];

  if (before.meta.name !== after.meta.name) {
    entries.push({
      kind: 'changed',
      partKind: 'profile',
      id: '__meta.name__',
      label: '项目名称',
      changes: [{ field: 'name', before: before.meta.name, after: after.meta.name }],
    });
  }

  const beforeProfiles = new Map(before.profiles.map((p) => [p.id, p]));
  const afterProfiles = new Map(after.profiles.map((p) => [p.id, p]));
  for (const [id, p] of afterProfiles) {
    const prev = beforeProfiles.get(id);
    if (!prev) {
      entries.push({ kind: 'added', partKind: 'profile', id, label: labelOfProfile(p) });
    } else {
      const changes = compareProfile(prev, p);
      if (changes.length > 0)
        entries.push({
          kind: 'changed',
          partKind: 'profile',
          id,
          label: labelOfProfile(p),
          changes,
        });
    }
  }
  for (const [id, p] of beforeProfiles) {
    if (!afterProfiles.has(id)) {
      entries.push({ kind: 'removed', partKind: 'profile', id, label: labelOfProfile(p) });
    }
  }

  const beforePanels = new Map(before.panels.map((p) => [p.id, p]));
  const afterPanels = new Map(after.panels.map((p) => [p.id, p]));
  for (const [id, p] of afterPanels) {
    const prev = beforePanels.get(id);
    if (!prev) {
      entries.push({ kind: 'added', partKind: 'panel', id, label: labelOfPanel(p) });
    } else {
      const changes = comparePanel(prev, p);
      if (changes.length > 0)
        entries.push({ kind: 'changed', partKind: 'panel', id, label: labelOfPanel(p), changes });
    }
  }
  for (const [id, p] of beforePanels) {
    if (!afterPanels.has(id)) {
      entries.push({ kind: 'removed', partKind: 'panel', id, label: labelOfPanel(p) });
    }
  }

  return { nameChanged: before.meta.name !== after.meta.name, entries, isEmpty: entries.length === 0 };
}

/** diff 的简短人读摘要（用于版本历史 summary）。 */
export function summarizeDiff(diff: ModelDiff): string {
  const added = diff.entries.filter((e) => e.kind === 'added');
  const removed = diff.entries.filter((e) => e.kind === 'removed');
  const changed = diff.entries.filter((e) => e.kind === 'changed');
  const parts: string[] = [];
  if (added.length > 0) parts.push(`新增 ${added.length}`);
  if (removed.length > 0) parts.push(`删除 ${removed.length}`);
  if (changed.length > 0) parts.push(`修改 ${changed.length}`);
  return parts.length === 0 ? '无实质变更' : parts.join('，');
}
