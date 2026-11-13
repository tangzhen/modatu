import { buildSeedCatalog } from '@modatu/catalog';
import type { DesignModel } from '@modatu/design-model';
import { describe, expect, it } from 'vitest';
import { evaluateSafetyRules } from '../src';

function wideFrame(): DesignModel {
  return {
    meta: { name: '长桌', unit: 'mm', precision: 0.5 },
    profiles: [
      { id: 'col-1', specCode: '3030', cutLength: 2000, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [] },
      { id: 'beam-long', specCode: '2020', cutLength: 2200, position: { x: 0, y: 500, z: 30 }, orientation: 'x', connections: [] },
      { id: 'beam-ok', specCode: '3030', cutLength: 800, position: { x: 0, y: 1000, z: 30 }, orientation: 'z', connections: [] },
    ],
    panels: [
      { id: 'top', materialId: 'pm-ply-15', thickness: 15, width: 2200, height: 600, position: { x: 0, y: 2000, z: 0 }, plane: 'xz' },
      { id: 'small', materialId: 'pm-ply-15', thickness: 15, width: 400, height: 300, position: { x: 0, y: 500, z: 30 }, plane: 'xz' },
    ],
  };
}

describe('规则化安全提示求值', () => {
  const catalog = buildSeedCatalog();

  it('跨度超限的水平型材触发提示，立柱不触发', () => {
    const hints = evaluateSafetyRules(wideFrame(), catalog);
    const spanHints = hints.filter((h) => h.ruleId === 'sr-span');
    expect(spanHints.map((h) => h.partId).sort()).toEqual(['beam-long']); // 立柱 col-1 不算跨度
    expect(spanHints[0]?.message).toContain('2200');
  });

  it('层板大跨度触发查表提醒', () => {
    const hints = evaluateSafetyRules(wideFrame(), catalog);
    const panelHints = hints.filter((h) => h.ruleId === 'sr-panel-load');
    expect(panelHints.map((h) => h.partId)).toEqual(['top']); // small 400mm 不超限
  });

  it('合规设计无提示', () => {
    const ok: DesignModel = {
      meta: { name: '小凳', unit: 'mm', precision: 0.5 },
      profiles: [
        { id: 'c', specCode: '3030', cutLength: 450, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [] },
      ],
      panels: [
        { id: 'seat', materialId: 'pm-ply-15', thickness: 15, width: 400, height: 400, position: { x: 0, y: 450, z: 0 }, plane: 'xz' },
      ],
    };
    expect(evaluateSafetyRules(ok, catalog)).toHaveLength(0);
  });

  it('停用规则不参与求值', () => {
    const catalogDisabled = {
      ...catalog,
      safetyRules: catalog.safetyRules.map((r) => ({ ...r, enabled: false })),
    };
    expect(evaluateSafetyRules(wideFrame(), catalogDisabled)).toHaveLength(0);
  });

  it('未知规则类型被安全跳过', () => {
    const weird = {
      ...catalog,
      safetyRules: [
        ...catalog.safetyRules,
        {
          id: 'sr-unknown',
          ruleType: 'future-rule' as never,
          params: {},
          messageTemplate: 'x',
          enabled: true,
          updatedAt: '',
        },
      ],
    };
    expect(() => evaluateSafetyRules(wideFrame(), weird)).not.toThrow();
  });

  it('规则参数缺失时跳过该规则', () => {
    const noParams = {
      ...catalog,
      safetyRules: [
        {
          id: 'sr-bad',
          ruleType: 'max-unsupported-span' as const,
          params: {},
          messageTemplate: 'x',
          enabled: true,
          updatedAt: '',
        },
      ],
    };
    expect(evaluateSafetyRules(wideFrame(), noParams)).toHaveLength(0);
  });
});
