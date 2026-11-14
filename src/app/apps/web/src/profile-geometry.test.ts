import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSeedCatalogIncludingDisabled } from '@modatu/catalog';
import { getProfileGeometry, orientationAxis, profileWorldDims } from './components/profile-geometry';

/** 渲染适配层：真实 3030 截面 → 挤出几何（含孔洞）；缓存与朝向映射。 */
describe('profile-geometry', () => {
  const catalog = buildSeedCatalogIncludingDisabled();
  const spec3030 = catalog.profiles.find((p) => p.code === '3030')!;

  it('3030 精确截面挤出：形状含 5 个孔（中央腔 + 四角工艺孔）', () => {
    expect(spec3030.crossSection).toBeDefined();
    const entry = getProfileGeometry(spec3030);
    // 直接从几何顶点校验：外轮廓 30×30、有内孔（顶点数远多于简单盒体）
    entry.geometry.computeBoundingBox();
    const bb = entry.geometry.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(30, 0);
    expect(bb.max.y - bb.min.y).toBeCloseTo(30, 0);
    // ExtrudeGeometry 无孔盒体顶点 ~24 个；带 5 孔的精确截面顶点远大于此
    expect(entry.geometry.attributes.position.count).toBeGreaterThan(200);
    // EdgesGeometry 同步生成
    expect(entry.edges.attributes.position.count).toBeGreaterThan(0);
  });

  it('同规格复用缓存（同 updatedAt 同实例）', () => {
    const a = getProfileGeometry(spec3030);
    const b = getProfileGeometry(spec3030);
    expect(a.geometry).toBe(b.geometry);
  });

  it('无精确截面时回落参数化（2020 种子现含截面，此处分构造未知规格验证兜底）', () => {
    const bare = { ...spec3030, code: '9999', crossSection: undefined };
    const entry = getProfileGeometry(bare);
    expect(entry.geometry).not.toBe(getProfileGeometry(spec3030).geometry);
  });

  it('朝向映射与既有盒体一致', () => {
    expect(profileWorldDims(undefined, 800, 'x')).toEqual([800, 30, 30]);
    expect(profileWorldDims(undefined, 1500, 'y')).toEqual([30, 1500, 30]);
    expect(profileWorldDims(undefined, 600, 'z')).toEqual([30, 30, 600]);
    expect(orientationAxis('x').axis).toEqual(new THREE.Vector3(1, 0, 0));
    expect(orientationAxis('y').axis).toEqual(new THREE.Vector3(0, 1, 0));
    expect(orientationAxis('z').axis).toEqual(new THREE.Vector3(0, 0, 1));
  });
});
