/**
 * 迷你 DXF 解析器（seed 专用，服务端无浏览器依赖）。
 *
 * 从 apps/web/src/lib/import-cross-section.ts 的 DXF 分支移植：仅 ENTITIES 段的
 * LINE / LWPOLYLINE(含 bulge) / ARC / CIRCLE —— 厂家截面图纸的四种常用图元；
 * 尺寸标注等开放图元在闭环组装阶段自然被过滤。环归一化复用 @modatu/catalog。
 */
import { normalizeLoops, polygonSignedArea, type ProfileCrossSection } from '@modatu/catalog';

export class DxfImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DxfImportError';
  }
}

interface DxfSeg {
  kind: 'line' | 'arc';
  a: [number, number];
  b: [number, number];
  /** arc: 圆心/半径/起止角（弧度，CCW a0→a1） */
  arc?: { cx: number; cy: number; r: number; a0: number; a1: number };
}

function parseDxfSegments(content: string): DxfSeg[] {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length < 2 || !/SECTION/.test(content)) throw new DxfImportError('不是有效的 DXF 文本');
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push({ code: parseInt(lines[i]!.trim(), 10), value: lines[i + 1]! });
  }
  const segs: DxfSeg[] = [];
  let cur: { type: string; props: Array<{ code: number; value: string }> } | null = null;
  let inEntities = false;
  const num = (props: Array<{ code: number; value: string }>, code: number): number => {
    const p = props.find((q) => q.code === code);
    return p ? parseFloat(p.value) : NaN;
  };
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      inEntities = pairs[i + 1]?.code === 2 && pairs[i + 1]?.value === 'ENTITIES';
      cur = null;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      inEntities = false;
      cur = null;
      continue;
    }
    if (!inEntities) continue;
    if (p.code === 0) {
      cur = { type: p.value, props: [] };
      continue;
    }
    if (!cur) continue;
    cur.props.push(p);
    if (cur.type === 'LINE' && p.code === 31) {
      segs.push({ kind: 'line', a: [num(cur.props, 10), num(cur.props, 20)], b: [num(cur.props, 11), num(cur.props, 21)] });
      cur = null;
    } else if (cur.type === 'ARC' && p.code === 51) {
      const d = Math.PI / 180;
      const cx = num(cur.props, 10);
      const cy = num(cur.props, 20);
      const r = num(cur.props, 40);
      const a0 = num(cur.props, 50) * d;
      const a1 = num(cur.props, 51) * d;
      segs.push({
        kind: 'arc',
        a: [cx + r * Math.cos(a0), cy + r * Math.sin(a0)],
        b: [cx + r * Math.cos(a1), cy + r * Math.sin(a1)],
        arc: { cx, cy, r, a0, a1 },
      });
      cur = null;
    } else if (cur.type === 'CIRCLE' && p.code === 40) {
      const cx = num(cur.props, 10);
      const cy = num(cur.props, 20);
      const r = num(cur.props, 40);
      segs.push({
        kind: 'arc',
        a: [cx + r, cy],
        b: [cx + r, cy],
        arc: { cx, cy, r, a0: 0, a1: 2 * Math.PI },
      });
      cur = null;
    } else if (cur.type === 'SEQEND') {
      cur = null;
    }
  }
  // LWPOLYLINE：属性流式，需要单独按实体聚合（0 LWPOLYLINE 到下一个 0）
  let poly: { vertices: Array<[number, number, number]>; closed: boolean } | null = null;
  const flushPoly = () => {
    if (!poly || poly.vertices.length < 2) {
      poly = null;
      return;
    }
    const vs = poly.vertices;
    const closed = poly.closed;
    const count = closed ? vs.length : vs.length - 1;
    for (let i = 0; i < count; i++) {
      const [x1, y1, b] = vs[i]!;
      const j = (i + 1) % vs.length;
      const [x2, y2] = vs[j]!;
      appendWithBulge([x1, y1], [x2, y2], b);
    }
    poly = null;
  };
  const appendWithBulge = (p1: [number, number], p2: [number, number], bulge: number) => {
    if (!bulge || Math.abs(bulge) < 1e-9) {
      segs.push({ kind: 'line', a: p1, b: p2 });
      return;
    }
    // bulge = tan(θ/4)，θ 为带符号圆心角；b>0 表示从 p1 逆时针到 p2
    const theta = 4 * Math.atan(bulge);
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const chord = Math.hypot(dx, dy);
    if (chord < 1e-9) {
      segs.push({ kind: 'line', a: p1, b: p2 });
      return;
    }
    const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const midX = (p1[0] + p2[0]) / 2;
    const midY = (p1[1] + p2[1]) / 2;
    const h = r * Math.cos(theta / 2);
    const px = -dy / chord;
    const py = dx / chord;
    const sgn = bulge > 0 ? 1 : -1;
    const cx = midX + px * h * sgn;
    const cy = midY + py * h * sgn;
    if (bulge > 0) {
      const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
      segs.push({ kind: 'arc', a: p1, b: p2, arc: { cx, cy, r, a0, a1: a0 + theta } });
    } else {
      const a0 = Math.atan2(p2[1] - cy, p2[0] - cx);
      segs.push({ kind: 'arc', a: p2, b: p1, arc: { cx, cy, r, a0, a1: a0 - theta } });
    }
  };

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value === 'SECTION') {
      flushPoly();
      inEntities = pairs[i + 1]?.code === 2 && pairs[i + 1]?.value === 'ENTITIES';
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') {
      flushPoly();
      inEntities = false;
      continue;
    }
    if (!inEntities) continue;
    if (p.code === 0) {
      if (p.value === 'LWPOLYLINE') {
        flushPoly();
        poly = { vertices: [], closed: false };
      } else {
        flushPoly();
      }
      continue;
    }
    if (!poly) continue;
    if (p.code === 70) poly.closed = (parseInt(p.value, 10) & 1) === 1;
    else if (p.code === 10) poly.vertices.push([parseFloat(p.value), 0, 0]);
    else if (p.code === 20 && poly.vertices.length > 0) {
      poly.vertices[poly.vertices.length - 1]![1] = parseFloat(p.value);
    } else if (p.code === 42 && poly.vertices.length > 0) {
      poly.vertices[poly.vertices.length - 1]![2] = parseFloat(p.value);
    }
  }
  flushPoly();
  return segs;
}

/** 弧 → 折线点（不含首末），容差 0.02mm */
function arcToPoints(cx: number, cy: number, r: number, a0: number, a1: number, rev: boolean): Array<[number, number]> {
  const TOL = 0.02;
  const sweepFwd = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const n = Math.max(2, Math.ceil(Math.sqrt((r * sweepFwd) / (8 * TOL))));
  const pts: Array<[number, number]> = [];
  if (!rev) {
    for (let i = 1; i < n; i++) {
      const t = a0 + (sweepFwd * i) / n;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  } else {
    for (let i = 1; i < n; i++) {
      const t = a1 - (sweepFwd * i) / n;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  return pts;
}

function chainLoops(segs: DxfSeg[]): Array<Array<[number, number]>> {
  const key = (p: [number, number]) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const used = new Array<boolean>(segs.length).fill(false);
  const loops: Array<Array<[number, number]>> = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const s0 = segs[s]!;
    const startPt = s0.a;
    let curPt = s0.b;
    const loop: Array<[number, number]> = [[startPt[0], startPt[1]]];
    if (s0.kind === 'arc' && s0.arc) loop.push(...arcToPoints(s0.arc.cx, s0.arc.cy, s0.arc.r, s0.arc.a0, s0.arc.a1, false));
    let guard = 0;
    while (guard++ < 4096 && key(curPt) !== key(startPt)) {
      const ni = segs.findIndex(
        (sg, i) => !used[i] && (key(sg.a) === key(curPt) || key(sg.b) === key(curPt)),
      );
      if (ni < 0) break; // 开放链（尺寸标注线等）——丢弃
      const sg = segs[ni]!;
      used[ni] = true;
      const fwd = key(sg.a) === key(curPt);
      loop.push([fwd ? sg.a[0] : sg.b[0], fwd ? sg.a[1] : sg.b[1]]);
      if (sg.kind === 'arc' && sg.arc) loop.push(...arcToPoints(sg.arc.cx, sg.arc.cy, sg.arc.r, sg.arc.a0, sg.arc.a1, !fwd));
      curPt = fwd ? sg.b : sg.a;
    }
    if (key(curPt) === key(startPt) && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** DXF 文本 → 归一化截面（面积最大者为外轮廓，其余按孔洞）。 */
export function importDxfSection(
  content: string,
  spec: { width: number; height: number },
): { crossSection: ProfileCrossSection; aspectMismatch: boolean } {
  const segs = parseDxfSegments(content);
  if (segs.length === 0) throw new DxfImportError('DXF 中没有可识别的图元（支持 LINE/LWPOLYLINE/ARC/CIRCLE）');
  const loops = chainLoops(segs);
  if (loops.length === 0) throw new DxfImportError('DXF 中没有闭合轮廓');
  const withArea = loops.map((pts) => ({ points: pts, area: Math.abs(polygonSignedArea(pts)) }));
  withArea.sort((a, b) => b.area - a.area);
  const raw: Array<{ points: Array<[number, number]>; role: 'outer' | 'hole' }> = [
    { points: withArea[0]!.points, role: 'outer' },
    ...withArea.slice(1).map((l) => ({ points: l.points, role: 'hole' as const })),
  ];
  return normalizeLoops(raw, spec.width, spec.height, false);
}
