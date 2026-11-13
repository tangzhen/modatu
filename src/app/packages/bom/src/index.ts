import {
  findCompatibilities,
  findConnector,
  findPanelMaterial,
  findProfile,
  type CatalogSnapshot,
} from '@modatu/catalog';
import type { DesignModel } from '@modatu/design-model';

/**
 * BOM 生成纯函数（spec-05，接缝 3）：design JSON → BOM 行数组。
 * 无 IO、无状态。连接件数量由知识库兼容矩阵 + 用量系数推导；
 * 推导所需输入不足时显式标记"无法自动计算"，宁可带警告也不静默漏项。
 */

export interface BomProfileRow {
  specCode: string;
  /** mm，与设计数值一致 */
  cutLength: number;
  quantity: number;
}

export interface BomConnectorRow {
  connectorId: string;
  name: string;
  quantity: number;
}

export interface BomUnresolvedConnector {
  connectorId: string;
  connectorName: string | null;
  /** 无法推导数量的连接点（型材件 id 对） */
  joints: Array<{ fromPartId: string; toPartId: string; reason: string }>;
}

export interface BomPanelRow {
  materialId: string;
  materialName: string;
  /** mm */
  thickness: number;
  /** mm，宽×高（板面内尺寸） */
  width: number;
  height: number;
  quantity: number;
}

export interface BomWarning {
  code: 'missing-compatibility' | 'missing-part-reference';
  message: string;
}

export interface Bom {
  profiles: BomProfileRow[];
  connectors: BomConnectorRow[];
  unresolvedConnectors: BomUnresolvedConnector[];
  panels: BomPanelRow[];
  warnings: BomWarning[];
}

function dedupeKey(...parts: Array<string | number>): string {
  return parts.join('\u0000');
}

/**
 * 生成 BOM。
 * - 型材：同规格同切割长度合并计数。
 * - 连接件：遍历所有连接点，查兼容矩阵取 quantityPerJoint 累加；查不到时进入
 *   unresolvedConnectors 并输出警告（预览界面据此提示用户回编辑器修正）。
 * - 板材：同材质同厚度同宽高合并计数。
 */
export function generateBom(design: DesignModel, catalog: CatalogSnapshot): Bom {
  const warnings: BomWarning[] = [];

  // ---- 型材行：同规格同长度合并 ----
  const profileCounts = new Map<string, BomProfileRow>();
  for (const p of design.profiles) {
    const key = dedupeKey(p.specCode, p.cutLength);
    const row = profileCounts.get(key);
    if (row) row.quantity += 1;
    else profileCounts.set(key, { specCode: p.specCode, cutLength: p.cutLength, quantity: 1 });
  }
  const profiles = [...profileCounts.values()].sort(
    (a, b) => a.specCode.localeCompare(b.specCode) || a.cutLength - b.cutLength,
  );

  // ---- 连接件行：兼容矩阵 + 用量系数推导 ----
  const connectorCounts = new Map<string, number>();
  const unresolved = new Map<string, BomUnresolvedConnector>();

  for (const p of design.profiles) {
    for (const c of p.connections) {
      const target = design.profiles.find((q) => q.id === c.targetPartId);
      const connector = findConnector(catalog, c.connectorId);

      if (!connector) {
        const entry = unresolved.get(c.connectorId) ?? {
          connectorId: c.connectorId,
          connectorName: null,
          joints: [],
        };
        entry.joints.push({
          fromPartId: p.id,
          toPartId: c.targetPartId,
          reason: '连接件不存在或已停用',
        });
        unresolved.set(c.connectorId, entry);
        warnings.push({
          code: 'missing-part-reference',
          message: `连接件 ${c.connectorId} 不存在或已停用，无法计入清单（位于部件 ${p.id} → ${c.targetPartId}）`,
        });
        continue;
      }

      if (!target) {
        const entry = unresolved.get(c.connectorId) ?? {
          connectorId: c.connectorId,
          connectorName: connector.name,
          joints: [],
        };
        entry.joints.push({
          fromPartId: p.id,
          toPartId: c.targetPartId,
          reason: '连接目标部件不在设计中',
        });
        unresolved.set(c.connectorId, entry);
        warnings.push({
          code: 'missing-part-reference',
          message: `连接目标 ${c.targetPartId} 不在设计中，无法计算用量（部件 ${p.id}）`,
        });
        continue;
      }

      const rows = findCompatibilities(catalog, p.specCode, target.specCode).filter(
        (r) => r.connectorId === c.connectorId,
      );
      if (rows.length === 0) {
        const entry = unresolved.get(c.connectorId) ?? {
          connectorId: c.connectorId,
          connectorName: connector.name,
          joints: [],
        };
        entry.joints.push({
          fromPartId: p.id,
          toPartId: c.targetPartId,
          reason: `规格 ${p.specCode} × ${target.specCode} 无此连接件的兼容记录`,
        });
        unresolved.set(c.connectorId, entry);
        warnings.push({
          code: 'missing-compatibility',
          message: `连接件「${connector.name}」在 ${p.specCode} × ${target.specCode} 上无兼容记录，数量无法自动计算`,
        });
        continue;
      }

      connectorCounts.set(c.connectorId, (connectorCounts.get(c.connectorId) ?? 0) + rows[0]!.quantityPerJoint);
    }
  }

  const connectors: BomConnectorRow[] = [...connectorCounts.entries()]
    .map(([id, quantity]) => ({
      connectorId: id,
      name: findConnector(catalog, id)?.name ?? id,
      quantity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const unresolvedConnectors = [...unresolved.values()];

  // ---- 板材行：同材质同厚度同尺寸合并 ----
  const panelCounts = new Map<string, BomPanelRow>();
  for (const p of design.panels) {
    const material = findPanelMaterial(catalog, p.materialId);
    const key = dedupeKey(p.materialId, p.thickness, p.width, p.height);
    const row = panelCounts.get(key);
    if (row) row.quantity += 1;
    else
      panelCounts.set(key, {
        materialId: p.materialId,
        materialName: material?.name ?? p.materialId,
        thickness: p.thickness,
        width: p.width,
        height: p.height,
        quantity: 1,
      });
  }
  const panels = [...panelCounts.values()].sort(
    (a, b) => a.materialName.localeCompare(b.materialName) || b.width * b.height - a.width * a.height,
  );

  return { profiles, connectors, unresolvedConnectors, panels, warnings };
}

/** 单位与精度展示口径（spec-05：mm / 与设计数值一致）。 */
export function formatMm(v: number): string {
  return `${v} mm`;
}

/** 型材总质量估算（kg）：Σ 长度(m) × kg/m。用于参考信息。 */
export function estimateProfileMass(design: DesignModel, catalog: CatalogSnapshot): number {
  let mass = 0;
  for (const p of design.profiles) {
    const spec = findProfile(catalog, p.specCode);
    if (spec) mass += (p.cutLength / 1000) * spec.massPerMeter;
  }
  return Math.round(mass * 100) / 100;
}

/** 板材总质量估算（kg）：Σ 体积 × 密度。 */
export function estimatePanelMass(design: DesignModel, catalog: CatalogSnapshot): number {
  let mass = 0;
  for (const p of design.panels) {
    const material = findPanelMaterial(catalog, p.materialId);
    if (material) {
      const volumeCm3 =
        (p.width / 10) * (p.height / 10) * (p.thickness / 10);
      mass += (volumeCm3 * material.density) / 1000;
    }
  }
  return Math.round(mass * 100) / 100;
}
