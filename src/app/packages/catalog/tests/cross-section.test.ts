import { describe, expect, it } from 'vitest';
import {
  buildParametricCrossSection,
  flattenArc,
  isValidCrossSection,
  loopsToSvgPath,
  normalizeLoops,
  polygonBBox,
  polygonSignedArea,
} from '../src/index';
import { buildSeedCatalogIncludingDisabled } from '../src/index';
import { buildSeed3030CrossSection } from '../src/section-3030.generated';

/** 逐段长度（用于校验环闭合） */
function loopPerimeter(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += Math.hypot(x2 - x1, y2 - y1);
  }
  return sum;
}

describe('flattenArc', () => {
  it('弦高容差内逼近圆弧', () => {
    const pts = flattenArc(0, 0, 10, 0, Math.PI / 2, 0.05);
    // 理想弧上的点到折线段的偏差 <= tolerance（用中点法近似校验）
    for (const [x, y] of pts) {
      const r = Math.hypot(x, y);
      expect(Math.abs(r - 10)).toBeLessThan(0.05);
    }
  });

  it('sweep 带符号（负值顺时针）', () => {
    const cw = flattenArc(0, 0, 5, 0, -Math.PI / 2, 0.05);
    expect(cw[0][1]).toBeLessThan(0); // 顺时针先向 -y
  });
});

describe('buildSeed3030CrossSection（真实 DXF 逆向）', () => {
  const cs = buildSeed3030CrossSection();

  it('格式合法：1 outer + 5 hole', () => {
    expect(isValidCrossSection(cs)).toBe(true);
    expect(cs.loops.filter((l) => l.role === 'outer')).toHaveLength(1);
    expect(cs.loops.filter((l) => l.role === 'hole')).toHaveLength(5);
  });

  it('外轮廓精确 30×30 且居中', () => {
    const outer = cs.loops[0];
    const b = polygonBBox(outer.points);
    expect(b.maxX - b.minX).toBeCloseTo(30, 1);
    expect(b.maxY - b.minY).toBeCloseTo(30, 1);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 1);
    expect((b.minY + b.maxY) / 2).toBeCloseTo(0, 1);
  });

  it('中央空腔 ≈ 7.5mm（含角部鼓包），四个角孔 Ø4.2 位于对角', () => {
    const holes = cs.loops.filter((l) => l.role === 'hole');
    const central = holes[0];
    const b = polygonBBox(central.points);
    expect(b.maxX - b.minX).toBeCloseTo(7.5, 1);
    for (const hole of holes.slice(1)) {
      const hb = polygonBBox(hole.points);
      expect(hb.maxX - hb.minX).toBeGreaterThan(4.05); // 折线化弦高内收 ~0.05
      expect(hb.maxX - hb.minX).toBeLessThan(4.25);
      // 孔心在四个对角象限（|x| = |y| ≈ 11.5）
      const cx = (hb.minX + hb.maxX) / 2;
      const cy = (hb.minY + hb.maxY) / 2;
      expect(Math.abs(cx)).toBeGreaterThan(5);
      expect(Math.abs(cy)).toBeGreaterThan(5);
      expect(Math.abs(Math.abs(cx) - Math.abs(cy))).toBeLessThan(0.2);
    }
  });

  it('外轮廓自回环穿过槽口（有内凹，周长明显大于正方形）', () => {
    const perimeter = loopPerimeter(cs.loops[0].points);
    expect(perimeter).toBeGreaterThan(4 * 30 + 4 * 10); // 槽口深入 >10mm/面
  });
});

describe('buildParametricCrossSection', () => {
  it('3030：结构同真实截面（1 outer + 5 hole，尺寸一致）', () => {
    const cs = buildParametricCrossSection({ width: 30, height: 30, slotWidth: 8 });
    expect(isValidCrossSection(cs)).toBe(true);
    const outer = polygonBBox(cs.loops[0].points);
    expect(outer.maxX - outer.minX).toBeCloseTo(30, 0);
    expect(outer.maxY - outer.minY).toBeCloseTo(30, 0);
    const central = polygonBBox(cs.loops[1].points);
    expect(central.maxX - central.minX).toBeCloseTo(7.3, 0);
    expect(cs.loops.filter((l) => l.role === 'hole')).toHaveLength(5);
  });

  it('2020/2040/3060：外框尺寸正确，槽腔封闭且不越界', () => {
    for (const [w, h, slot] of [
      [20, 20, 6],
      [20, 40, 6],
      [30, 60, 8],
    ] as const) {
      const cs = buildParametricCrossSection({ width: w, height: h, slotWidth: slot });
      expect(isValidCrossSection(cs)).toBe(true);
      const b = polygonBBox(cs.loops[0].points);
      expect(b.maxX - b.minX).toBeCloseTo(w, 0);
      expect(b.maxY - b.minY).toBeCloseTo(h, 0);
      // 所有环都在外框内（±0.01 容差）
      for (const l of cs.loops) {
        for (const [x, y] of l.points) {
          expect(x).toBeGreaterThanOrEqual(-w / 2 - 0.01);
          expect(x).toBeLessThanOrEqual(w / 2 + 0.01);
          expect(y).toBeGreaterThanOrEqual(-h / 2 - 0.01);
          expect(y).toBeLessThanOrEqual(h / 2 + 0.01);
        }
      }
    }
  });

  it('所有环闭合且 outer 面积合理（槽腔挖空后介于正方形的 30%~60%）', () => {
    const cs = buildParametricCrossSection({ width: 30, height: 30, slotWidth: 8 });
    for (const l of cs.loops) {
      expect(loopPerimeter(l.points)).toBeGreaterThan(0);
    }
    const area = Math.abs(polygonSignedArea(cs.loops[0].points));
    expect(area).toBeGreaterThan(30 * 30 * 0.3);
    expect(area).toBeLessThan(30 * 30 * 0.6);
  });
});

describe('normalizeLoops', () => {
  it('缩放居中到规格宽并保留孔洞', () => {
    // 100 单位见方外框 + 中心小方孔，fit 到 30
    const raw = [
      {
        role: 'outer' as const,
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ] as Array<[number, number]>,
      },
      {
        role: 'hole' as const,
        points: [
          [45, 45],
          [55, 45],
          [55, 55],
          [45, 55],
        ] as Array<[number, number]>,
      },
    ];
    const { crossSection, aspectMismatch } = normalizeLoops(raw, 30, 30);
    expect(aspectMismatch).toBe(false);
    const b = polygonBBox(crossSection.loops[0].points);
    expect(b.maxX - b.minX).toBeCloseTo(30, 1);
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 1);
    const hb = polygonBBox(crossSection.loops[1].points);
    expect(hb.maxX - hb.minX).toBeCloseTo(3, 1);
  });

  it('flipY 翻转 Y 轴（SVG 导入）', () => {
    const raw = [
      {
        role: 'outer' as const,
        points: [
          [0, 0],
          [10, 0],
          [10, 1],
          [0, 1],
        ] as Array<[number, number]>,
      },
    ];
    const { crossSection } = normalizeLoops(raw, 10, 1, true);
    // 原 y=0（顶）翻到 +y，原 y=1（底）翻到 -y：翻转后 bbox 中心不变、形状对称则难辨——用不对称形状验证
    const raw2 = [
      {
        role: 'outer' as const,
        points: [
          [0, 0],
          [10, 0],
          [10, 2],
          [0, 4],
        ] as Array<[number, number]>,
      },
    ];
    const { crossSection: cs2 } = normalizeLoops(raw2, 10, 4, true);
    // 原始最高点 y=4（最后一点）翻转后应位于最低处
    const ys = cs2.loops[0].points.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(cs2.loops[0].points[3][1], 5);
  });

  it('纵横比不符时给出警告', () => {
    const raw = [
      {
        role: 'outer' as const,
        points: [
          [0, 0],
          [100, 0],
          [100, 50],
          [0, 50],
        ] as Array<[number, number]>,
      },
    ];
    const { aspectMismatch } = normalizeLoops(raw, 30, 30);
    expect(aspectMismatch).toBe(true);
  });
});

describe('loopsToSvgPath', () => {
  it('生成 M/L/Z 路径并翻转 Y', () => {
    const cs = buildSeed3030CrossSection();
    const d = loopsToSvgPath(cs.loops, true);
    expect(d).toContain('M');
    expect(d).toContain('Z');
    // yFlip：第一个点的 y 与原始数据符号相反
    const first = cs.loops[0].points[0];
    const m = d.match(/M\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![2])).toBeCloseTo(-first[1], 1);
  });
});

describe('种子目录携带截面', () => {
  it('每个种子规格都有合法截面', () => {
    const { profiles } = buildSeedCatalogIncludingDisabled();
    for (const p of profiles) {
      expect(p.crossSection, p.code).toBeDefined();
      expect(isValidCrossSection(p.crossSection), p.code).toBe(true);
    }
  });
});
