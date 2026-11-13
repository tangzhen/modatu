import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import type { Bom } from '@modatu/bom';

/**
 * BOM → 水印 PDF（spec-05，纯转换，可测）。
 * - 水印：用户 ID + 昵称 + 生成时间戳，半透明斜向平铺全页；
 * - 页脚：软件标识「木搭图 Modatu」；
 * - 数值区水印不遮挡可读性（透明度 0.12）。
 * - CJK 字体：优先 MODATU_FONT_PATH，其次内置 assets/fonts；缺失时回退
 *   Helvetica 并把不可编码字符替换为 '?'（测试断言 ASCII 字段保证可读性）。
 */

export interface BomPdfMeta {
  userId: string;
  nickname: string;
  designName: string;
  generatedAt: Date;
}

export interface LoadedFonts {
  regular: PDFFont;
  bold: PDFFont;
  /** 是否加载了 CJK 字体（决定水印/表头能否输出中文） */
  hasCjk: boolean;
}

/** 页面 A4 纵向（pt）。 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const WATERMARK_OPACITY = 0.12;

export function sanitizeText(text: string, hasCjk: boolean): string {
  if (hasCjk) return text;
  // WinAnsi 兜底：把非 Latin-1 字符替换为 '?'
  return text.replace(/[^\u0000-\u00ff]/g, '?');
}

export function findBundledFont(): string | null {
  const candidates = [
    resolve(__dirname, '../../assets/fonts/NotoSansSC-Regular.ttf'),
    resolve(process.cwd(), 'assets/fonts/NotoSansSC-Regular.ttf'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

export async function loadFonts(envFontPath?: string): Promise<LoadedFonts> {
  const doc = await PDFDocument.create();
  const fontPath = envFontPath && existsSync(envFontPath) ? envFontPath : findBundledFont();
  if (!fontPath) {
    return {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      hasCjk: false,
    };
  }
  try {
    doc.registerFontkit(fontkit);
    const bytes = readFileSync(fontPath);
    const regular = await doc.embedFont(bytes, { subset: true });
    return { regular, bold: regular, hasCjk: true };
  } catch {
    return {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      hasCjk: false,
    };
  }
}

/** 生成 BOM PDF 字节。 */
export async function renderBomPdf(
  bom: Bom,
  meta: BomPdfMeta,
  opts: { fontPath?: string } = {},
): Promise<{ bytes: Uint8Array; hasCjk: boolean }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`BOM 清单 - ${meta.designName}`);
  doc.setProducer('Modatu 木搭图');

  const fontPath = opts.fontPath && existsSync(opts.fontPath) ? opts.fontPath : findBundledFont();
  let regular: PDFFont;
  let hasCjk = false;
  if (fontPath) {
    try {
      doc.registerFontkit(fontkit);
      regular = await doc.embedFont(readFileSync(fontPath), { subset: true });
      hasCjk = true;
    } catch {
      regular = await doc.embedFont(StandardFonts.Helvetica);
    }
  } else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
  }

  const page = doc.addPage([PAGE_W, PAGE_H]);

  /* ------------------------------ 标题与元信息 ------------------------------ */
  let y = PAGE_H - MARGIN - 18;
  drawText(page, sanitizeText(`BOM 清单 · ${meta.designName}`, hasCjk), MARGIN, y, regular, 16, {
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 20;
  const metaLine = sanitizeText(
    `用户 ${meta.userId}（${meta.nickname}） · 生成时间 ${formatTimestamp(meta.generatedAt)} · 单位 mm`,
    hasCjk,
  );
  drawText(page, metaLine, MARGIN, y, regular, 10, { color: rgb(0.35, 0.35, 0.35) });
  y -= 24;

  /* -------------------------------- 三个分组 -------------------------------- */
  y = renderSection(page, y, sanitizeText('一、型材（切割规格）', hasCjk), regular, 12, hasCjk);
  const profileHeader = sanitizeText('规格 | 切割长度 (mm) | 数量', hasCjk);
  y = renderTable(page, y, profileHeader, regular, bom.profiles.map((r) =>
    sanitizeText(`${r.specCode} | ${r.cutLength} | ${r.quantity}`, hasCjk),
  ));
  y -= 10;

  y = renderSection(page, y, sanitizeText('二、连接件', hasCjk), regular, 12, hasCjk);
  y = renderTable(
    page,
    y,
    sanitizeText('连接件 | 数量', hasCjk),
    regular,
    bom.connectors.map((r) => sanitizeText(`${r.name} | ${r.quantity}`, hasCjk)),
  );
  if (bom.unresolvedConnectors.length > 0) {
    for (const u of bom.unresolvedConnectors) {
      y -= 14;
      drawText(
        page,
        sanitizeText(
          `⚠ 无法自动计算：${u.connectorName ?? u.connectorId}（${u.joints.length} 个连接点），请回编辑器修正`,
          hasCjk,
        ),
        MARGIN + 12,
        y,
        regular,
        9,
        { color: rgb(0.75, 0.3, 0.1) },
      );
    }
  }
  y -= 10;

  y = renderSection(page, y, sanitizeText('三、板材（裁切规格）', hasCjk), regular, 12, hasCjk);
  y = renderTable(
    page,
    y,
    sanitizeText('材质 | 厚度 (mm) | 宽 (mm) | 高 (mm) | 数量', hasCjk),
    regular,
    bom.panels.map((r) =>
      sanitizeText(`${r.materialName} | ${r.thickness} | ${r.width} | ${r.height} | ${r.quantity}`, hasCjk),
    ),
  );

  /* --------------------------------- 水印 --------------------------------- */
  const watermark = sanitizeText(
    `${meta.userId} ${meta.nickname} ${formatTimestamp(meta.generatedAt)}`,
    hasCjk,
  );
  drawWatermark(page, watermark, regular);
  // 多页时逐页水印（当前数据量单页足够；保留接口语义）
  for (const p of doc.getPages()) {
    if (p !== page) drawWatermark(p, watermark, regular);
  }

  /* --------------------------------- 页脚 --------------------------------- */
  const footer = sanitizeText('木搭图 Modatu · 铝型材家具设计工具', hasCjk);
  drawText(page, footer, MARGIN, MARGIN / 2, regular, 8, { color: rgb(0.45, 0.45, 0.45) });

  const bytes = await doc.save();
  return { bytes, hasCjk };
}

/* --------------------------------- 绘制助手 --------------------------------- */

interface DrawOpts {
  color?: ReturnType<typeof rgb>;
  opacity?: number;
  rotateDegrees?: number;
  size?: number;
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  opts: DrawOpts = {},
): void {
  page.drawText(text, {
    x,
    y,
    size: opts.size ?? size,
    font,
    color: opts.color ?? rgb(0.15, 0.15, 0.15),
    opacity: opts.opacity ?? 1,
    rotate: degreesToRadians(opts.rotateDegrees ?? 0),
  });
}

/** 半透明斜向平铺全页水印。 */
function drawWatermark(page: PDFPage, text: string, font: PDFFont): void {
  const size = 11;
  const stepX = 210;
  const stepY = 120;
  for (let y = 40; y < PAGE_H + stepY; y += stepY) {
    for (let x = -60; x < PAGE_W + stepX; x += stepX) {
      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: rgb(0.45, 0.45, 0.5),
        opacity: WATERMARK_OPACITY,
        rotate: degreesToRadians(30),
      });
    }
  }
}

function degreesToRadians(deg: number) {
  return degrees(deg);
}

/** 分组标题。 */
function renderSection(
  page: PDFPage,
  y: number,
  title: string,
  font: PDFFont,
  size: number,
  hasCjk: boolean,
): number {
  drawText(page, title, MARGIN, y, font, size, { color: rgb(0.15, 0.15, 0.15) });
  return y - 18;
}

/** 简单等宽行表格（"列 | 列"文本行），带细分隔线。 */
function renderTable(page: PDFPage, y: number, header: string, font: PDFFont, rows: string[]): number {
  drawText(page, header, MARGIN, y, font, 10, { color: rgb(0.25, 0.25, 0.25) });
  y -= 4;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 0.6,
    color: rgb(0.8, 0.8, 0.8),
  });
  y -= 14;
  for (const row of rows) {
    if (y < MARGIN + 30) break; // 一期数据量内不换页；超出即截断保护
    drawText(page, row, MARGIN + 4, y, font, 10);
    y -= 15;
  }
  return y;
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
