import { buildSeedCatalog, type CatalogSnapshot } from '@modatu/catalog';
import type { DesignModel } from '@modatu/design-model';
import { describe, expect, it } from 'vitest';
import { estimatePanelMass, estimateProfileMass, generateBom } from '../src';

function shelf(): DesignModel {
  return {
    meta: { name: '书架', unit: 'mm', precision: 0.5 },
    profiles: [
      { id: 'c1', specCode: '3030', cutLength: 1800, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [
        { connectorId: 'cn-corner-8', targetPartId: 'r1' },
        { connectorId: 'cn-tbolt-8', targetPartId: 'r2' },
      ] },
      { id: 'c2', specCode: '3030', cutLength: 1800, position: { x: 800, y: 0, z: 0 }, orientation: 'y', connections: [] },
      { id: 'c3', specCode: '3030', cutLength: 1800, position: { x: 1600, y: 0, z: 0 }, orientation: 'y', connections: [] },
      { id: 'r1', specCode: '3030', cutLength: 1600, position: { x: 30, y: 0, z: 30 }, orientation: 'x', connections: [] },
      { id: 'r2', specCode: '3030', cutLength: 1600, position: { x: 30, y: 600, z: 30 }, orientation: 'x', connections: [] },
      { id: 'r3', specCode: '3030', cutLength: 1600, position: { x: 30, y: 1200, z: 30 }, orientation: 'x', connections: [] },
    ],
    panels: [
      { id: 'p1', materialId: 'pm-ply-15', thickness: 15, width: 1540, height: 300, position: { x: 30, y: 300, z: 30 }, plane: 'xz' },
      { id: 'p2', materialId: 'pm-ply-15', thickness: 15, width: 1540, height: 300, position: { x: 30, y: 900, z: 30 }, plane: 'xz' },
      { id: 'p3', materialId: 'pm-mdf-18', thickness: 18, width: 1600, height: 500, position: { x: 0, y: 1800, z: 0 }, plane: 'xz' },
    ],
  };
}

describe('BOM 纯函数', () => {
  const catalog: CatalogSnapshot = buildSeedCatalog();

  it('型材同规格同长度合并计数', () => {
    const bom = generateBom(shelf(), catalog);
    expect(bom.profiles).toEqual([
      { specCode: '3030', cutLength: 1600, quantity: 3 },
      { specCode: '3030', cutLength: 1800, quantity: 3 },
    ]);
  });

  it('连接件按兼容矩阵系数推导', () => {
    const bom = generateBom(shelf(), catalog);
    // c1→r1 角码 2 件；c1→r2 T型螺栓 1 件
    expect(bom.connectors).toEqual([
      { connectorId: 'cn-corner-8', name: '角码 8 系列（30 槽）', quantity: 2 },
      { connectorId: 'cn-tbolt-8', name: 'T 型螺栓+螺母 8 系列（30 槽）', quantity: 1 },
    ]);
    expect(bom.unresolvedConnectors).toHaveLength(0);
    expect(bom.warnings).toHaveLength(0);
  });

  it('同规格同长度的合并不合并不同长度', () => {
    const design = shelf();
    design.profiles.push({
      id: 'c4',
      specCode: '3030',
      cutLength: 900,
      position: { x: 0, y: 0, z: 0 },
      orientation: 'y',
      connections: [],
    });
    const bom = generateBom(design, catalog);
    expect(bom.profiles).toHaveLength(3);
  });

  it('缺失兼容连接件时显式标记无法自动计算', () => {
    const design = shelf();
    // 换成 2020 立柱 → 3030 × 2020 无兼容行
    design.profiles[1]!.specCode = '2020';
    design.profiles[1]!.cutLength = 1800;
    design.profiles[1]!.connections = [
      { connectorId: 'cn-corner-8', targetPartId: 'r1' },
    ];
    const bom = generateBom(design, catalog);
    expect(bom.connectors).toHaveLength(2); // c1 的 corner-8 与 tbolt-8 仍可解析
    expect(bom.unresolvedConnectors).toHaveLength(1);
    expect(bom.unresolvedConnectors[0]?.joints[0]?.reason).toContain('无此连接件的兼容记录');
    expect(bom.warnings.some((w) => w.code === 'missing-compatibility')).toBe(true);
  });

  it('未知连接件进入 unresolved 并警告', () => {
    const design = shelf();
    design.profiles[0]!.connections.push({ connectorId: 'cn-gone', targetPartId: 'r1' });
    const bom = generateBom(design, catalog);
    expect(bom.unresolvedConnectors.some((u) => u.connectorId === 'cn-gone')).toBe(true);
    expect(bom.warnings.some((w) => w.code === 'missing-part-reference')).toBe(true);
  });

  it('板材合并并带材质名', () => {
    const bom = generateBom(shelf(), catalog);
    expect(bom.panels).toEqual([
      { materialId: 'pm-ply-15', materialName: '多层实木板', thickness: 15, width: 1540, height: 300, quantity: 2 },
      { materialId: 'pm-mdf-18', materialName: '中密度纤维板', thickness: 18, width: 1600, height: 500, quantity: 1 },
    ]);
  });

  it('空设计产出空清单', () => {
    const bom = generateBom(
      { meta: { name: 'x', unit: 'mm', precision: 0.5 }, profiles: [], panels: [] },
      catalog,
    );
    expect(bom.profiles).toHaveLength(0);
    expect(bom.connectors).toHaveLength(0);
    expect(bom.panels).toHaveLength(0);
    expect(bom.warnings).toHaveLength(0);
  });

  it('质量估算', () => {
    const mass = estimateProfileMass(shelf(), catalog);
    // (1800*3 + 1600*3) mm * 1.26 kg/m = 5.4m + 4.8m = 10.2m → 12.852 → 12.85
    expect(mass).toBeCloseTo(12.85, 2);
    const panelMass = estimatePanelMass(shelf(), catalog);
    // 0.77m²×15mm + 0.77×18mm … 纯数值断言
    expect(panelMass).toBeGreaterThan(0);
  });

  it('BOM 不随重复调用变化（纯函数）', () => {
    const a = generateBom(shelf(), catalog);
    const b = generateBom(shelf(), catalog);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
