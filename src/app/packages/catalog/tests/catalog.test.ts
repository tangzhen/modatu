import { describe, expect, it } from 'vitest';
import {
  buildSeedCatalog,
  buildSeedCatalogIncludingDisabled,
  findCompatibilities,
  findConnector,
  findPanelMaterial,
  findProfile,
  findProfileIncludingDisabled,
  hasCompatibility,
  interpolateTemplate,
} from '../src';

describe('catalog 查询助手', () => {
  const catalog = buildSeedCatalog();

  it('findProfile 仅返回启用规格', () => {
    expect(findProfile(catalog, '3030')).toBeDefined();
    expect(findProfile(catalog, '4040')).toBeUndefined(); // 种子中的停用条目
    expect(findProfile(catalog, '9999')).toBeUndefined();
  });

  it('findProfileIncludingDisabled 返回停用条目（存量设计打开用）', () => {
    const full = buildSeedCatalogIncludingDisabled();
    expect(full.profiles.find((p) => p.code === '4040')?.enabled).toBe(false);
    expect(findProfileIncludingDisabled({ ...catalog, profiles: full.profiles }, '4040')).toBeDefined();
  });

  it('兼容矩阵方向对称', () => {
    expect(hasCompatibility(catalog, '3030', '3060')).toBe(true);
    expect(hasCompatibility(catalog, '3060', '3030')).toBe(true);
    expect(hasCompatibility(catalog, '2020', '3030')).toBe(false); // 槽宽不同系列
  });

  it('停用连接件的兼容行不可见', () => {
    const withDisabledConnector = {
      ...catalog,
      connectors: catalog.connectors.map((c) =>
        c.id === 'cn-corner-8' ? { ...c, enabled: false } : c,
      ),
    };
    // 仅剩 tbolt-8 可用
    const rows = findCompatibilities(withDisabledConnector, '3030', '3030');
    expect(rows.map((r) => r.connectorId)).toEqual(['cn-tbolt-8']);
  });

  it('findPanelMaterial 仅返回启用材质', () => {
    expect(findPanelMaterial(catalog, 'pm-ply-15')).toBeDefined();
    const disabled = { ...catalog, panelMaterials: [] };
    expect(findPanelMaterial(disabled, 'pm-ply-15')).toBeUndefined();
  });

  it('findConnector 仅返回启用连接件', () => {
    expect(findConnector(catalog, 'cn-corner-6')).toBeDefined();
  });

  it('模板插值替换与保留未知占位符', () => {
    expect(interpolateTemplate('跨度 {span}mm 上限 {max}', { span: 1600 })).toBe(
      '跨度 1600mm 上限 {max}',
    );
  });
});
