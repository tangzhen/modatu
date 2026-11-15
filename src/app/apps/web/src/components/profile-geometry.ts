/**
 * 渲染适配层（渲染器无关环数据 → three.js 几何）。
 * 将来更换 canvas 2D / 自研 GPU-WASM 管线时，只需重写本模块，数据层与交互层不动。
 *
 * 几何约定：
 * - 截面环在 XY 平面（宽=X、高=Y、中心原点），挤出沿 +Z、深度 1；
 *   每根型材 mesh 用 scale.z = cutLength 伸缩（截面形状不随长度变形）。
 * - 朝向映射与既有盒体实现一致（min-corner 定位语义不变）：
 *   z: X=宽,Y=高,Z=长 | x: X=长,Y=高,Z=宽 | y: X=宽,Y=长,Z=高
 * - 缓存键 = `${code}:${updatedAt}:${来源有效性}`，同规格共享一份几何。
 */
import * as THREE from 'three';
import {
  buildParametricCrossSection,
  isValidCrossSection,
  polygonBBox,
  type ProfileSpec,
} from '@modatu/catalog';

export interface ProfileGeometryEntry {
  /** 沿 +Z 挤出的单位深度几何（scale.z = 切割长度） */
  geometry: THREE.ExtrudeGeometry;
  /** 选中描边用（与 geometry 同一顶点集） */
  edges: THREE.EdgesGeometry;
}

const cache = new Map<string, ProfileGeometryEntry>();

function sectionOf(spec: ProfileSpec) {
  if (spec.crossSection && isValidCrossSection(spec.crossSection)) return spec.crossSection;
  // 兜底：参数化近似截面（精确几何请后台导入 DXF/SVG）
  return buildParametricCrossSection({ width: spec.width, height: spec.height, slotWidth: spec.slotWidth });
}

function buildEntry(spec: ProfileSpec): ProfileGeometryEntry {
  const section = sectionOf(spec);
  const outerLoop = section.loops.find((l) => l.role === 'outer')!;
  const shape = new THREE.Shape(outerLoop.points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of section.loops) {
    if (hole.role !== 'hole') continue;
    const path = new THREE.Path(hole.points.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes.push(path);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geometry.computeVertexNormals();
  // 居中修正：渲染层按 min-corner + 中心放置 mesh（scale.z = 切割长度），
  // 而 ExtrudeGeometry 从 z=0 挤到 z=depth、截面 XY 可能带 DXF 原始偏移。
  // 这里把包围盒中心移到原点，保证几何体严格以原点为中心（min-corner 语义成立）。
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  geometry.translate(
    -(bb.min.x + bb.max.x) / 2,
    -(bb.min.y + bb.max.y) / 2,
    -(bb.min.z + bb.max.z) / 2,
  );
  const edges = new THREE.EdgesGeometry(geometry, 24);
  return { geometry, edges };
}

export function getProfileGeometry(spec: ProfileSpec): ProfileGeometryEntry {
  const hasSection = Boolean(spec.crossSection && isValidCrossSection(spec.crossSection));
  const key = `${spec.code}:${spec.updatedAt}:${hasSection ? 'x' : 'p'}`;
  let entry = cache.get(key);
  if (!entry) {
    entry = buildEntry(spec);
    cache.set(key, entry);
    // 简单防膨胀：缓存超过 64 项时清掉最旧的（重建设计不频繁换规格）
    if (cache.size > 64) {
      const first = cache.keys().next().value;
      if (first !== undefined) {
        const old = cache.get(first);
        old?.geometry.dispose();
        old?.edges.dispose();
        cache.delete(first);
      }
    }
  }
  return entry;
}

/** 每朝向的世界尺寸（min-corner 到 max-corner），与既有盒体实现一致 */
export function profileWorldDims(spec: ProfileSpec | undefined, cutLength: number, orientation: 'x' | 'y' | 'z'): [number, number, number] {
  const w = spec?.width ?? 30;
  const h = spec?.height ?? 30;
  if (orientation === 'x') return [cutLength, h, w];
  if (orientation === 'y') return [w, cutLength, h];
  return [w, h, cutLength];
}

/** 朝向 → 把 +Z 挤出几何映射到挤出轴的旋转 */
export function orientationQuaternion(orientation: 'x' | 'y' | 'z'): THREE.Quaternion {
  if (orientation === 'x') return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  if (orientation === 'y') return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  return new THREE.Quaternion();
}

/** 挤出轴（世界系）与该轴上截面中心偏移（min-corner → 挤出起点所在端） */
export function orientationAxis(orientation: 'x' | 'y' | 'z'): { axis: THREE.Vector3; lengthIndex: 0 | 1 | 2 } {
  if (orientation === 'x') return { axis: new THREE.Vector3(1, 0, 0), lengthIndex: 0 };
  if (orientation === 'y') return { axis: new THREE.Vector3(0, 1, 0), lengthIndex: 1 };
  return { axis: new THREE.Vector3(0, 0, 1), lengthIndex: 2 };
}

/** 诊断用：截面外轮廓实际 bbox（与规格宽高比对可发现截面数据异常） */
export function profileBBoxSize(spec: ProfileSpec): { width: number; height: number } {
  const section = sectionOf(spec);
  const outer = section.loops.find((l) => l.role === 'outer') ?? section.loops[0];
  const b = polygonBBox(outer.points);
  return { width: b.maxX - b.minX, height: b.maxY - b.minY };
}
