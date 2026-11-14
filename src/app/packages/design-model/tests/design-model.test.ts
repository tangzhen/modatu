import { buildSeedCatalog, type CatalogSnapshot } from '@modatu/catalog';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  diffModels,
  emptyDesign,
  isHalfMmAligned,
  parseDesign,
  snapToHalfMm,
  summarizeDiff,
  validateSchema,
  type DesignModel,
} from '../src';
import { validateAgainstCatalog, validateFull } from '../src';

function frameDesign(): DesignModel {
  return {
    meta: { name: '书架', unit: 'mm', precision: 0.5 },
    profiles: [
      {
        id: 'col-left',
        specCode: '3030',
        cutLength: 1800,
        position: { x: 0, y: 0, z: 0 },
        orientation: 'y',
        connections: [
          { connectorId: 'cn-corner-8', targetPartId: 'rail-bottom' },
          { connectorId: 'cn-corner-8', targetPartId: 'rail-top' },
        ],
      },
      {
        id: 'rail-bottom',
        specCode: '3030',
        cutLength: 800,
        position: { x: 0, y: 0, z: 30 },
        orientation: 'x',
        connections: [],
      },
      {
        id: 'rail-top',
        specCode: '3030',
        cutLength: 800,
        position: { x: 0, y: 1800, z: 30 },
        orientation: 'x',
        connections: [],
      },
    ],
    panels: [
      {
        id: 'shelf-1',
        materialId: 'pm-ply-15',
        thickness: 15,
        width: 740,
        height: 300,
        position: { x: 30, y: 600, z: 30 },
        plane: 'xz',
      },
    ],
  };
}

describe('design-model Schema 校验', () => {
  it('合法模型通过并补全 connections 默认值', () => {
    const result = parseDesign(frameDesign());
    expect(result.ok).toBe(true);
    expect(result.design?.profiles[0]?.connections).toHaveLength(2);
  });

  it('缺字段被拒绝', () => {
    const bad = frameDesign();
    delete (bad.profiles[0] as unknown as Record<string, unknown>).cutLength;
    const { ok, issues } = validateSchema(bad);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.path.includes('cutLength'))).toBe(true);
  });

  it('精度违规（非 0.5 倍数）被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[1]!.cutLength = 800.25;
    const { ok, issues } = validateSchema(bad);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.message.includes('0.5mm'))).toBe(true);
  });

  it('位置非 0.5 对齐也被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[2]!.position.y = 1799.7;
    expect(validateSchema(bad).ok).toBe(false);
  });

  it('重复部件 id 被拒绝', () => {
    const bad = frameDesign();
    bad.panels[0]!.id = bad.profiles[0]!.id;
    const { ok, issues } = validateSchema(bad);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.message.includes('重复'))).toBe(true);
  });

  it('连接目标不是型材件被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[0]!.connections = [{ connectorId: 'cn-corner-8', targetPartId: 'no-such' }];
    const { ok, issues } = validateSchema(bad);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.message.includes('不是本设计中的型材件'))).toBe(true);
  });

  it('负/零切割长度被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[0]!.cutLength = 0;
    expect(validateSchema(bad).ok).toBe(false);
  });

  it('精度助手', () => {
    expect(isHalfMmAligned(1200)).toBe(true);
    expect(isHalfMmAligned(1200.5)).toBe(true);
    expect(isHalfMmAligned(1200.25)).toBe(false);
    expect(isHalfMmAligned(0.1)).toBe(false);
    expect(snapToHalfMm(1200.4)).toBe(1200.5);
    expect(snapToHalfMm(1200.49)).toBe(1200.5);
    expect(snapToHalfMm(1199.99)).toBe(1200);
  });

  it('canonicalJson 对键序不敏感', () => {
    const a = frameDesign();
    const shuffled = JSON.parse(JSON.stringify(a));
    expect(canonicalJson(a)).toBe(canonicalJson(shuffled));
    const modified = frameDesign();
    modified.profiles[1]!.cutLength = 700;
    expect(canonicalJson(a)).not.toBe(canonicalJson(modified));
  });
});

describe('design-model 知识库引用校验', () => {
  const catalog: CatalogSnapshot = buildSeedCatalog();

  it('合法引用通过', () => {
    expect(validateAgainstCatalog(frameDesign(), catalog).ok).toBe(true);
  });

  it('未知规格引用被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[0]!.specCode = '5050';
    const { ok, issues } = validateAgainstCatalog(bad, catalog);
    expect(ok).toBe(false);
    expect(issues[0]?.message).toContain('5050');
  });

  it('停用规格引用被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[0]!.specCode = '4040';
    const { ok, issues } = validateAgainstCatalog(bad, catalog);
    expect(ok).toBe(false);
    expect(issues[0]?.message).toContain('停用');
  });

  it('切割长度超出规格允许范围被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[0]!.cutLength = 5000; // 3030 max 3000
    const { ok, issues } = validateAgainstCatalog(bad, catalog);
    expect(ok).toBe(false);
    expect(issues[0]?.message).toContain('允许范围');
  });

  it('无兼容连接件的规格组合被拒绝', () => {
    const bad = frameDesign();
    // rail-bottom 换成 2020：3030 × 2020 无兼容行
    bad.profiles[1]!.specCode = '2020';
    bad.profiles[1]!.cutLength = 600;
    const { ok, issues } = validateAgainstCatalog(bad, catalog);
    expect(ok).toBe(false);
    expect(issues.some((i) => i.message.includes('没有可用的兼容连接件'))).toBe(true);
  });

  it('未知/停用连接件被拒绝', () => {
    const bad = frameDesign();
    bad.profiles[0]!.connections[0]!.connectorId = 'cn-corner-6'; // 6 系角码不兼容 3030×3030
    expect(validateAgainstCatalog(bad, catalog).issues.length).toBeGreaterThan(0);

    const bad2 = frameDesign();
    bad2.profiles[0]!.connections[0]!.connectorId = 'cn-gone';
    const { ok, issues } = validateAgainstCatalog(bad2, catalog);
    expect(ok).toBe(false);
    expect(issues[0]?.message).toContain('不存在或已停用');
  });

  it('厚度不在材质列表被拒绝', () => {
    const bad = frameDesign();
    bad.panels[0]!.thickness = 10;
    const { ok, issues } = validateAgainstCatalog(bad, catalog);
    expect(ok).toBe(false);
    expect(issues[0]?.message).toContain('常用厚度');
  });

  it('validateFull 双步校验：schema 失败时不做目录校验', () => {
    const bad = frameDesign();
    bad.profiles[0]!.specCode = '5050';
    bad.profiles[0]!.cutLength = -1;
    const result = validateFull(bad, catalog);
    expect(result.schema.ok).toBe(false);
    expect(result.catalog.issues).toHaveLength(0);
    expect(result.design).toBeUndefined();
  });

  it('validateFull 合法模型返回规范化 design', () => {
    const result = validateFull(frameDesign(), catalog);
    expect(result.schema.ok).toBe(true);
    expect(result.catalog.ok).toBe(true);
    expect(result.design?.profiles).toHaveLength(3);
  });

  it('finishId：快照含颜色条目时校验存在且启用；省略 finishes 则跳过', () => {
    const withFinish: CatalogSnapshot = {
      ...buildSeedCatalog(),
      finishes: [
        { id: 'finish-black', code: 'black', name: '黑色', colorHex: '#2b2e33', enabled: true, updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'finish-off', code: 'off', name: '停用色', colorHex: '#000', enabled: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
    };
    const good = frameDesign();
    good.profiles[0]!.finishId = 'finish-black';
    expect(validateAgainstCatalog(good, withFinish).ok).toBe(true);

    const missing = frameDesign();
    missing.profiles[0]!.finishId = 'finish-nope';
    const r1 = validateAgainstCatalog(missing, withFinish);
    expect(r1.ok).toBe(false);
    expect(r1.issues[0]?.path).toContain('finishId');

    const disabled = frameDesign();
    disabled.profiles[0]!.finishId = 'finish-off';
    expect(validateAgainstCatalog(disabled, withFinish).ok).toBe(false);

    // 旧快照（无 finishes 字段）：finishId 引用不做存在性校验
    const legacy = frameDesign();
    legacy.profiles[0]!.finishId = 'finish-black';
    expect(validateAgainstCatalog(legacy, catalog).ok).toBe(true);
  });
});

describe('design-model diff', () => {
  it('识别新增/删除/修改', () => {
    const before = frameDesign();
    const after = frameDesign();
    after.profiles[1]!.cutLength = 900;
    after.profiles = after.profiles.filter((p) => p.id !== 'rail-top');
    after.panels.push({
      id: 'shelf-2',
      materialId: 'pm-mdf-18',
      thickness: 18,
      width: 740,
      height: 300,
      position: { x: 30, y: 1200, z: 30 },
      plane: 'xz',
    });

    const diff = diffModels(before, after);
    const kinds = diff.entries.map((e) => e.kind);
    expect(kinds).toContain('changed');
    expect(kinds).toContain('removed');
    expect(kinds).toContain('added');
    expect(diff.isEmpty).toBe(false);

    const changed = diff.entries.find((e) => e.kind === 'changed' && e.id === 'rail-bottom');
    expect(changed && changed.kind === 'changed' && changed.changes[0]?.field).toBe('cutLength');
  });

  it('相同模型 diff 为空', () => {
    const d = frameDesign();
    const diff = diffModels(d, JSON.parse(JSON.stringify(d)));
    expect(diff.isEmpty).toBe(true);
  });

  it('名称变更计入 diff 与摘要', () => {
    const before = frameDesign();
    const after = frameDesign();
    after.meta.name = '新书架';
    const diff = diffModels(before, after);
    expect(diff.nameChanged).toBe(true);
    expect(summarizeDiff(diff)).toContain('修改 1');
  });

  it('摘要格式', () => {
    const before = frameDesign();
    const after = frameDesign();
    after.panels.push({
      id: 'p2',
      materialId: 'pm-ply-15',
      thickness: 15,
      width: 10,
      height: 10,
      position: { x: 0, y: 0, z: 0 },
      plane: 'xy',
    });
    after.profiles = after.profiles.filter((p) => p.id !== 'rail-top');
    const diff = diffModels(before, after);
    expect(summarizeDiff(diff)).toBe('新增 1，删除 1');
  });

  it('emptyDesign 可通过校验', () => {
    expect(parseDesign(emptyDesign()).ok).toBe(true);
  });
});
