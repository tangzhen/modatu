import {
  findCompatibilities,
  findConnector,
  findPanelMaterial,
  findProfile,
  type CatalogSnapshot,
} from '@modatu/catalog';
import { parseDesign } from './schema';
import type { DesignIssue, DesignModel, ValidationResult } from './schema';

/**
 * 知识库引用校验（spec-02 实现决策：服务端在保存与 AI 应用入口强制执行）。
 *
 * - 引用的规格/连接件/材质必须存在且**启用**（停用条目拒绝入库，新设计不可选）。
 * - 切割长度必须在规格允许范围内。
 * - 封板厚度必须在材质常用厚度列表内。
 * - 每个连接的两侧规格必须有兼容连接件（兼容矩阵）。
 */
export function validateAgainstCatalog(
  model: DesignModel,
  catalog: CatalogSnapshot,
): ValidationResult {
  const issues: DesignIssue[] = [];

  for (const p of model.profiles) {
    const spec = findProfile(catalog, p.specCode);
    if (!spec) {
      issues.push({
        path: `profiles.${p.id}.specCode`,
        message: `规格 ${p.specCode} 不存在或已停用`,
      });
      continue;
    }
    if (p.cutLength < spec.minCutLength || p.cutLength > spec.maxCutLength) {
      issues.push({
        path: `profiles.${p.id}.cutLength`,
        message: `切割长度 ${p.cutLength}mm 超出规格 ${spec.code} 允许范围 [${spec.minCutLength}, ${spec.maxCutLength}]`,
      });
    }
    for (const c of p.connections) {
      const connector = findConnector(catalog, c.connectorId);
      if (!connector) {
        issues.push({
          path: `profiles.${p.id}.connections.${c.connectorId}`,
          message: `连接件 ${c.connectorId} 不存在或已停用`,
        });
        continue;
      }
      const target = model.profiles.find((q) => q.id === c.targetPartId);
      const connectorCompatible =
        target !== undefined &&
        findCompatibilities(catalog, p.specCode, target.specCode).some(
          (row) => row.connectorId === c.connectorId,
        );
      if (target && !connectorCompatible) {
        issues.push({
          path: `profiles.${p.id}.connections.${c.connectorId}`,
          message: `规格 ${p.specCode} 与 ${target.specCode} 之间没有可用的兼容连接件`,
        });
      }
    }
  }

  for (const panel of model.panels) {
    const material = findPanelMaterial(catalog, panel.materialId);
    if (!material) {
      issues.push({
        path: `panels.${panel.id}.materialId`,
        message: `板材材质 ${panel.materialId} 不存在或已停用`,
      });
      continue;
    }
    if (!material.thicknesses.includes(panel.thickness)) {
      issues.push({
        path: `panels.${panel.id}.thickness`,
        message: `厚度 ${panel.thickness}mm 不在材质「${material.name}」常用厚度 [${material.thicknesses.join(', ')}] 内`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** 两步校验合并入口。schema 失败时不再做目录校验。 */
export function validateFull(
  model: unknown,
  catalog: CatalogSnapshot,
): { schema: ValidationResult; catalog: ValidationResult; design?: DesignModel } {
  const schema = parseDesign(model);
  if (!schema.ok || !schema.design) {
    return { schema, catalog: { ok: false, issues: [] } };
  }
  const catalogResult = validateAgainstCatalog(schema.design, catalog);
  return {
    schema: { ok: true, issues: [] },
    catalog: catalogResult,
    design: schema.design,
  };
}
