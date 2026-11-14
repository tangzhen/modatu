import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import type { DataSource } from 'typeorm';
import { ProfileFinishEntity, ProfileSpecEntity } from '../db/entities/catalog.entity';
import { importDxfSection } from './dxf-parse';

/**
 * materials folder 导入（任务"原始信息入独立 folder"）。
 *
 * 数据源：`src/app/materials/jlc/**`（嘉立创采集归档，见 materials/README.md）。
 * app 代码不引用该目录任何文件；只有本 seed 脚本通过 fs 读取。
 *
 * 导入内容：
 * - profile_finishes：颜色条目（id/显示名/Modatu 代表性渲染色）
 * - profile_specs 更新：米重/米价（基准 + 按颜色）、槽宽槽深（厂家语义截面配置）、
 *   精确截面（DXF 解析；仅当现有截面无来源存档时覆盖，不碰管理员后台导入的数据）
 *
 * 幂等：重复执行只刷新事实字段。
 */

/** 导入的主流欧标规格子集（其余 151 规格留作归档参考） */
const MODATU_CODES = ['2020', '2040', '3030', '3060', '4040'] as const;

/** 颜色中文名 → 稳定 finish 条目（colorHex 为 Modatu 自选代表色，非厂家贴图） */
const FINISH_TABLE: Array<{ id: string; code: string; name: string; colorHex: string; match: RegExp }> = [
  { id: 'finish-natural', code: 'natural', name: '本色（喷砂氧化）', colorHex: '#b9c1c9', match: /本色/ },
  { id: 'finish-black', code: 'black', name: '黑色（喷砂氧化）', colorHex: '#2b2e33', match: /黑色/ },
  { id: 'finish-white', code: 'white', name: '白色（烤漆）', colorHex: '#e9ebed', match: /白色/ },
  { id: 'finish-wood', code: 'wood', name: '原木色（烤漆+转印）', colorHex: '#b98a5e', match: /原木色/ },
  { id: 'finish-silver', code: 'silver', name: '银白氧化', colorHex: '#d6dade', match: /银白/ },
  { id: 'finish-graphite', code: 'graphite', name: '喷砂电泳', colorHex: '#9aa0a6', match: /喷砂电泳/ },
];

/** 解析 "0.85kg/米" / "23.86元/米" 类字符串 */
function parseAmount(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const m = raw.match(/([\d.]+)/);
  const v = m ? parseFloat(m[1]!) : NaN;
  return Number.isFinite(v) ? v : null;
}

function resolveMaterialsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../materials'), // npm run seed（cwd=apps/server）
    path.resolve(process.cwd(), 'materials'), // cwd=src/app
    path.resolve(__dirname, '../../../../materials'), // dist/seed → apps/server/dist → src/app
  ];
  for (const c of candidates) {
    if (existsSync(path.join(c, 'jlc', 'captured-at.json'))) return c;
  }
  throw new Error(
    `找不到 materials folder（尝试：${candidates.join(' , ')}）。请先采集归档（见 materials/README.md）。`,
  );
}

interface JlcMaterialRow {
  color?: string | null;
  meterWeight?: string | null;
  meterPrice?: string | null;
  thickness?: string | null;
  profileCode?: string | null;
}

interface JlcProduct {
  bizKey: string;
  profileProductModel: string;
  productName: string;
  thickness?: string | null;
  materials?: JlcMaterialRow[] | null;
}

interface JlcSectionRecord {
  bizKey: string;
  profileProductModel?: string | null;
  w?: number | null;
  h?: number | null;
}

interface JlcSectionConfig {
  face0?: { vertex?: Array<{ x: number; y: number }> };
  sideFaces?: Array<{ slots?: Array<{ width?: number; depth?: number }> | null } | null>;
}

export async function seedMaterials(dataSource: DataSource): Promise<void> {
  const dir = resolveMaterialsDir();
  const jlcDir = path.join(dir, 'jlc');

  const sectionList = (JSON.parse(await readFile(path.join(jlcDir, 'api', 'section-list.json'), 'utf-8')) as {
    data?: { list?: JlcProduct[] } | null;
  }).data?.list ?? [];
  const sectionRecords = (JSON.parse(await readFile(path.join(jlcDir, 'api', 'section-records.json'), 'utf-8')) as {
    data?: JlcSectionRecord[] | null;
  }).data ?? [];

  // 每个目标规格选一个欧标产品（products 数量多于规格；欧标优先）
  const productsByCode = new Map<string, JlcProduct>();
  for (const code of MODATU_CODES) {
    const candidates = sectionList.filter((p) =>
      new RegExp(`^${code}铝型材( 欧标)?$`).test(p.productName ?? ''),
    );
    const euFirst = candidates.sort((a, b) =>
      a.productName.includes('欧标') === b.productName.includes('欧标') ? 0 : a.productName.includes('欧标') ? -1 : 1,
    );
    if (euFirst[0]) productsByCode.set(code, euFirst[0]);
  }
  if (productsByCode.size === 0) {
    console.log('materials：未找到目标规格产品，跳过。');
    return;
  }

  const recordByBizKey = new Map(sectionRecords.map((r) => [r.bizKey, r]));

  /* --------------------------- 颜色条目 --------------------------- */
  const finishRepo = dataSource.getRepository(ProfileFinishEntity);
  const usedColors = new Set<string>();
  for (const p of productsByCode.values()) {
    for (const m of p.materials ?? []) if (m.color) usedColors.add(m.color);
  }
  const finishIdByColor = new Map<string, string>();
  for (const color of [...usedColors].sort()) {
    if (!color) continue;
    const fin = FINISH_TABLE.find((f) => f.match.test(color));
    if (!fin) {
      console.log(`materials：颜色「${color}」无映射条目，跳过。`);
      continue;
    }
    finishIdByColor.set(color, fin.id);
    const existing = await finishRepo.findOne({ where: { id: fin.id } });
    if (existing) {
      existing.code = fin.code;
      existing.name = fin.name;
      existing.colorHex = fin.colorHex;
      existing.enabled = true;
      await finishRepo.save(existing);
    } else {
      await finishRepo.save(finishRepo.create({ ...fin, enabled: true }));
    }
  }
  console.log(`materials：颜色条目 ${finishIdByColor.size} 条（${[...finishIdByColor.keys()].join('/')}）`);

  /* --------------------------- 规格更新 --------------------------- */
  const specRepo = dataSource.getRepository(ProfileSpecEntity);
  let updated = 0;
  let sections = 0;
  for (const [code, product] of productsByCode) {
    const record = recordByBizKey.get(product.bizKey);
    const spec = await specRepo.findOne({ where: { code } });
    if (!spec || !record) {
      console.log(`materials：规格 ${code} 缺少${spec ? '截面记录' : '知识库条目'}，跳过。`);
      continue;
    }

    // 语义截面配置 → 槽宽/槽深（行业标准事实）
    let slotWidth: number | null = null;
    let slotDepth: number | null = null;
    try {
      const cfg = JSON.parse(
        await readFile(
          path.join(jlcDir, 'profiles', product.profileProductModel, 'section-config.json'),
          'utf-8',
        ),
      ) as JlcSectionConfig;
      const slot = cfg.sideFaces?.[0]?.slots?.[0];
      if (slot?.width && slot?.depth) {
        slotWidth = slot.width;
        slotDepth = slot.depth;
      }
    } catch {
      // 配置缺失时保留现有槽参数
    }

    // DXF → 精确截面（仅当现有截面无来源存档时覆盖；不碰管理员后台导入）
    let imported = 0;
    if (!spec.crossSectionSource) {
      try {
        const dxf = await readFile(
          path.join(jlcDir, 'profiles', product.profileProductModel, `${product.profileProductModel}.dxf`),
          'utf-8',
        );
        const w = record.w ?? spec.width;
        const h = record.h ?? spec.height;
        const { crossSection, aspectMismatch } = importDxfSection(dxf, { width: w, height: h });
        if (!aspectMismatch) {
          spec.crossSection = crossSection;
          spec.crossSectionSource = { format: 'dxf', content: dxf };
          imported = 1;
        } else {
          console.log(`materials：${code} DXF 纵横比与 ${w}x${h} 不符，保留现有截面。`);
        }
      } catch (e) {
        console.log(`materials：${code} DXF 解析失败，保留现有截面：${String(e)}`);
      }
    }

    // 米重/米价（按颜色）
    const finishPrices: Record<string, number> = {};
    let priceNatural: number | null = null;
    for (const m of product.materials ?? []) {
      const price = parseAmount(m.meterPrice);
      const finId = m.color ? finishIdByColor.get(m.color) : undefined;
      if (!finId) continue;
      if (price !== null) finishPrices[finId] = price;
      if (!priceNatural && price !== null) priceNatural = price;
    }
    const mass = parseAmount((product.materials ?? [])[0]?.meterWeight);

    spec.massPerMeter = mass ?? spec.massPerMeter;
    spec.pricePerMeter = priceNatural ?? spec.pricePerMeter ?? null;
    spec.finishPrices = Object.keys(finishPrices).length > 0 ? finishPrices : (spec.finishPrices ?? null);
    if (slotWidth !== null && slotDepth !== null) {
      spec.slotWidth = slotWidth;
      spec.slotDepth = slotDepth;
    }
    await specRepo.save(spec);
    updated += 1;
    sections += imported;
    console.log(
      `materials：${code} ← ${product.profileProductModel}（米重 ${spec.massPerMeter}kg/m，本色 ${spec.pricePerMeter ?? '—'} 元/m，颜色价 ${Object.keys(finishPrices).length} 种${imported ? '，截面已导入' : ''}）`,
    );
  }
  console.log(`materials 导入完成：规格 ${updated}/${productsByCode.size}，DXF 截面 ${sections} 份。`);
}
