/**
 * 型材截面：归一化多边形环数据（渲染器无关，spec-04 "截面 + 挤出"决策的落地）。
 *
 * 设计约定：
 * - 权威存储格式 = 本文件的 ProfileCrossSection（mm、截面中心为原点、显式 outer/hole）。
 *   three.js 挤出、canvas 2D、未来自研 GPU/WASM 渲染管线都消费同一份数据，
 *   更换渲染适配层不需要动数据层。
 * - DXF/SVG 只是后台导入的交换格式：导入时一次性拍平（弧线按弦高容差折线化）并
 *   归一化（保纵横比缩放至规格宽、居中）后入库；渲染期不再解析外部文件。
 * - 坐标系：X 向右、Y 向上（DXF 同向；SVG 导入时 Y 翻转由导入器处理）。
 */

export interface CrossSectionLoop {
  /** 闭合多边形顶点（mm，弧线已按弦高容差折线化，不含重复的闭合点） */
  points: Array<[number, number]>;
  /** outer = 实体最外轮廓（自回环穿过槽口）；hole = 实体内部的孔（中央腔、工艺孔等） */
  role: 'outer' | 'hole';
}

export interface ProfileCrossSection {
  version: 1;
  unit: 'mm';
  origin: 'center';
  loops: CrossSectionLoop[];
}

/** 导入时的来源存档（仅后台可见，用于审计与将来以更优容差重新推导） */
export interface CrossSectionSource {
  format: 'dxf' | 'svg';
  /** 原始文件文本（DXF 为 ASCII；SVG 为 markup） */
  content: string;
}

/** 弦高容差：弧线折线化的最大偏差（mm） */
export const ARC_TOLERANCE_MM = 0.05;

export function isValidCrossSection(value: unknown): value is ProfileCrossSection {
  if (typeof value !== 'object' || value === null) return false;
  const cs = value as ProfileCrossSection;
  if (cs.version !== 1 || cs.unit !== 'mm' || cs.origin !== 'center') return false;
  if (!Array.isArray(cs.loops) || cs.loops.length === 0) return false;
  const outers = cs.loops.filter((l) => l.role === 'outer');
  if (outers.length !== 1) return false;
  return cs.loops.every(
    (l) =>
      Array.isArray(l.points) &&
      l.points.length >= 3 &&
      l.points.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])),
  );
}

/* ------------------------------ 几何小工具 ------------------------------ */

export function polygonSignedArea(points: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polygonBBox(points: Array<[number, number]>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** 圆弧 → 折线点（不含首末端点）；sweep 带符号，正值逆时针。tolerance 为弦高。 */
export function flattenArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  sweep: number,
  tolerance = ARC_TOLERANCE_MM,
): Array<[number, number]> {
  const absSweep = Math.abs(sweep);
  const n = Math.max(2, Math.ceil(Math.sqrt((r * absSweep) / (8 * tolerance))));
  const dir = sweep >= 0 ? 1 : -1;
  const pts: Array<[number, number]> = [];
  for (let i = 1; i < n; i++) {
    const t = startAngle + (dir * absSweep * i) / n;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}

/* --------------------------- 导入归一化 --------------------------- */

export interface NormalizeResult {
  crossSection: ProfileCrossSection;
  /** 拟合后纵横比与目标规格不符时为 true（提示可能导错了文件） */
  aspectMismatch: boolean;
  /** 归一化前原始 bbox（mm，仅诊断用） */
  sourceBBox: { width: number; height: number };
}

/**
 * 把导入器解出的原始环（任意单位/位置）归一化为标准截面：
 * 统一缩放（保纵横比）使外环宽度 = fitWidth，中心移到原点，坐标取 2 位小数。
 * flipY 用于 SVG（Y 轴向下）导入。
 */
export function normalizeLoops(
  rawLoops: Array<{ points: Array<[number, number]>; role: 'outer' | 'hole' }>,
  fitWidth: number,
  fitHeight: number,
  flipY = false,
): NormalizeResult {
  const flipped = flipY
    ? rawLoops.map((l) => ({ ...l, points: l.points.map(([x, y]) => [x, -y] as [number, number]) }))
    : rawLoops;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of flipped) {
    const b = polygonBBox(l.points);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const srcW = maxX - minX;
  const srcH = maxY - minY;
  const scale = fitWidth / srcW;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const round1 = (v: number) => Math.round(v * scale * 100) / 100;
  const loops = flipped.map((l) => ({
    role: l.role,
    points: l.points.map(([x, y]) => [round1(x - cx), round1(y - cy)] as [number, number]),
  }));
  const expectedH = (srcH * fitWidth) / srcW;
  return {
    crossSection: { version: 1, unit: 'mm', origin: 'center', loops },
    aspectMismatch: Math.abs(expectedH - fitHeight) / fitHeight > 0.05,
    sourceBBox: { width: srcW, height: srcH },
  };
}

/* ------------------------------ 预览辅助 ------------------------------ */

/** 环数据 → SVG path（配合 fill-rule="evenodd"），供后台预览/缩略图。yFlip 用于屏幕坐标系。 */
export function loopsToSvgPath(loops: CrossSectionLoop[], yFlip = true, scale = 1): string {
  return loops
    .map((l) => {
      const pts = l.points.map(([x, y]) => [(x * scale).toFixed(2), ((yFlip ? -y : y) * scale).toFixed(2)]);
      return `M ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
    })
    .join(' ');
}

/* --------------------------- 参数化截面生成 --------------------------- */

/**
 * 按嘉立创欧标 T 型腔结构生成参数化截面（结构逆向自其公开 3030 DXF 图纸）：
 * 每面槽口 = 倒角嘴(slot+2.2s 宽) → 颈部(slot+0.2s) → T 型腔(2.06s 宽，45° 斜壁收口 +
 * 底面 V 定位槽) 封闭凹袋；中央圆角方空腔（面侧微凹 + 四角鼓包）；四角 Ø 工艺孔。
 * 各槽腔互不连通：拓扑 = 1 条自回环外轮廓 + 若干孔，与真实图纸一致。
 *
 * s = slotWidth / 8 为槽宽比例因子；非 3030 规格为近似种子，精确几何走后台 DXF 导入。
 */
export function buildParametricCrossSection(input: {
  width: number;
  height: number;
  slotWidth: number;
}): ProfileCrossSection {
  const { width: w, height: h, slotWidth } = input;
  const s = slotWidth / 8;
  const tol = ARC_TOLERANCE_MM;
  const halfW = w / 2;
  const halfH = h / 2;
  const minHalf = Math.min(halfW, halfH);

  const cornerR = Math.min(w, h) / 15;
  const mouthHalfW = (slotWidth + 2.2 * s) / 2;
  const mouthD = 0.1 * slotWidth;
  const neckHalfW = (slotWidth + 0.2 * s) / 2;
  const neckD = 0.14 * slotWidth;
  const ceilD = mouthD + neckD; // 腔顶距面
  const chamberHalfW = 1.03 * slotWidth;
  const chamberVertD = 0.43 * slotWidth;
  const chamberDepth = Math.min(1.15 * slotWidth, minHalf - 0.74 * slotWidth);
  const floorHalfW = 0.55 * slotWidth;
  const notchHalfW = 0.065 * slotWidth;
  const notchD = 0.04 * slotWidth;

  /**
   * 外轮廓（CCW，实体始终在行走方向左侧）。
   * 面定义：n̂ = 面外法向，t̂ = rot90(n̂) = 行走方向；每面沿 t̂ 从 -(L-r) 走到 +(L-r)。
   */
  type Face = { nx: number; ny: number; tx: number; ty: number; half: number; alongHalf: number };
  const faces: Face[] = [
    { nx: 1, ny: 0, tx: 0, ty: 1, half: halfW, alongHalf: halfH }, // 右面，沿 +y
    { nx: 0, ny: 1, tx: -1, ty: 0, half: halfH, alongHalf: halfW }, // 顶面，沿 -x
    { nx: -1, ny: 0, tx: 0, ty: -1, half: halfW, alongHalf: halfH }, // 左面，沿 -y
    { nx: 0, ny: -1, tx: 1, ty: 0, half: halfH, alongHalf: halfW }, // 底面，沿 +x
  ];

  const outer: Array<[number, number]> = [];
  for (const f of faces) {
    // pt(along, depth)：depth 从面向内为正
    const pt = (along: number, depth: number): [number, number] => [
      f.nx * (f.half - depth) + f.tx * along,
      f.ny * (f.half - depth) + f.ty * along,
    ];
    const startAlong = -(f.alongHalf - cornerR);
    // 面段（角弧结束后到嘴缘）
    outer.push(pt(startAlong, 0));
    outer.push(pt(-mouthHalfW, 0));
    // 嘴部倒角：下沉 → 收窄 → 下到腔顶
    outer.push(pt(-mouthHalfW, mouthD));
    outer.push(pt(-neckHalfW, mouthD));
    outer.push(pt(-neckHalfW, ceilD));
    // T 腔：顶板外扩 → 竖壁 → 45° 斜壁 → 底板（带中心 V 槽）→ 对侧 mirrored
    outer.push(pt(-chamberHalfW, ceilD));
    outer.push(pt(-chamberHalfW, ceilD + chamberVertD));
    outer.push(pt(-floorHalfW, chamberDepth));
    outer.push(pt(-notchHalfW, chamberDepth));
    outer.push(pt(0, chamberDepth + notchD));
    outer.push(pt(notchHalfW, chamberDepth));
    outer.push(pt(floorHalfW, chamberDepth));
    outer.push(pt(chamberHalfW, ceilD + chamberVertD));
    outer.push(pt(chamberHalfW, ceilD));
    // 颈部 → 嘴部 → 面
    outer.push(pt(neckHalfW, ceilD));
    outer.push(pt(neckHalfW, mouthD));
    outer.push(pt(mouthHalfW, mouthD));
    outer.push(pt(mouthHalfW, 0));
    outer.push(pt(f.alongHalf - cornerR, 0));
    // 角弧：圆心在截面内侧象限 (n̂(half-r) + t̂(L-r))，从 n̂ 方向扫 90° 到 t̂ 方向
    const ccx = f.nx * (f.half - cornerR) + f.tx * (f.alongHalf - cornerR);
    const ccy = f.ny * (f.half - cornerR) + f.ty * (f.alongHalf - cornerR);
    const nAng = Math.atan2(f.ny, f.nx);
    outer.push(...flattenArc(ccx, ccy, cornerR, nAng, Math.PI / 2, tol));
  }

  // 中央空腔：面侧凹弧（r=0.425s，±32.3°）+ 四角半圆鼓包（r=0.094s，圆心 ±0.376s）
  const cavity: Array<[number, number]> = [];
  const faceR = 0.425 * slotWidth;
  const faceArcHalf = (32.3 * Math.PI) / 180;
  const cornerCx = 0.376 * slotWidth;
  const cornerR2 = 0.094 * slotWidth;
  for (let k = 0; k < 4; k++) {
    const faceAng = (k * Math.PI) / 2;
    cavity.push(...flattenArc(0, 0, faceR, faceAng - faceArcHalf, faceArcHalf * 2, tol));
    // 角弧圆心位于两相邻面方向的角平分象限 (±cx, ±cx)
    const ccx = Math.cos(faceAng) * cornerCx + Math.cos(faceAng + Math.PI / 2) * cornerCx;
    const ccy = Math.sin(faceAng) * cornerCx + Math.sin(faceAng + Math.PI / 2) * cornerCx;
    // 角弧从 faceAng-45° 扫 180° 到 faceAng+135°（鼓向对角）
    cavity.push(...flattenArc(ccx, ccy, cornerR2, faceAng - Math.PI / 4, Math.PI, tol));
  }

  // 四角工艺孔：r=0.2625s，距两面各 3.5·sz
  const sz = Math.min(w, h) / 30;
  const holeR = 0.2625 * slotWidth;
  const holeX = halfW - 3.5 * sz;
  const holeY = halfH - 3.5 * sz;
  const holes: Array<Array<[number, number]>> = [];
  if (holeX > holeR + 1 && holeY > holeR + 1) {
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const) {
      holes.push(flattenArc(sx * holeX, sy * holeY, holeR, 0, Math.PI * 2, tol));
    }
  }

  const round2 = (pts: Array<[number, number]>): Array<[number, number]> =>
    pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);

  return {
    version: 1,
    unit: 'mm',
    origin: 'center',
    loops: [
      { points: round2(outer), role: 'outer' },
      { points: round2(cavity), role: 'hole' },
      ...holes.map((hPts) => ({ points: round2(hPts), role: 'hole' as const })),
    ],
  };
}
