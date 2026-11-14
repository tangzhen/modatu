import type {
  CatalogSnapshot,
  Compatibility,
  Connector,
  PanelMaterial,
  ProfileSpec,
  SafetyRule,
} from './types';
import { buildParametricCrossSection } from './cross-section';
import { buildSeed3030CrossSection } from './section-3030.generated';

/**
 * 初始知识库种子数据（spec-01 Further Notes：2020/2040/3030 主流欧标系列及常用连接件）。
 * 实施期人工录入的合理起点；上线前由管理员在后台核对/扩充。
 * 数值参考行业通用口径，仅作为规则化提示与清单依据，非精确力学数据。
 *
 * 截面：3030 为嘉立创公开 DXF 图纸逆向的精确几何；其余规格为同结构参数化近似，
 * 精确几何可在后台上传厂家 DXF 覆盖。
 */

const UPDATED_AT = '2026-01-01T00:00:00.000Z';

const profiles: ProfileSpec[] = [
  {
    id: 'ps-2020',
    code: '2020',
    series: '欧标2020',
    width: 20,
    height: 20,
    slotWidth: 6,
    slotDepth: 5.2,
    massPerMeter: 0.46,
    minCutLength: 20,
    maxCutLength: 3000,
    loadRatings: [
      { span: 500, load: 15 },
      { span: 1000, load: 5 },
    ],
    crossSection: buildParametricCrossSection({ width: 20, height: 20, slotWidth: 6 }),
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'ps-2040',
    code: '2040',
    series: '欧标2040',
    width: 20,
    height: 40,
    slotWidth: 6,
    slotDepth: 5.2,
    massPerMeter: 0.83,
    minCutLength: 20,
    maxCutLength: 3000,
    loadRatings: [
      { span: 500, load: 35 },
      { span: 1000, load: 14 },
      { span: 1500, load: 7 },
    ],
    crossSection: buildParametricCrossSection({ width: 20, height: 40, slotWidth: 6 }),
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'ps-3030',
    code: '3030',
    series: '欧标3030',
    width: 30,
    height: 30,
    slotWidth: 8,
    slotDepth: 6,
    massPerMeter: 1.26,
    minCutLength: 30,
    maxCutLength: 3000,
    loadRatings: [
      { span: 500, load: 60 },
      { span: 1000, load: 25 },
      { span: 1500, load: 13 },
      { span: 2000, load: 8 },
    ],
    crossSection: buildSeed3030CrossSection(),
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'ps-3060',
    code: '3060',
    series: '欧标3060',
    width: 30,
    height: 60,
    slotWidth: 8,
    slotDepth: 6,
    massPerMeter: 2.39,
    minCutLength: 30,
    maxCutLength: 3000,
    loadRatings: [
      { span: 1000, load: 55 },
      { span: 1500, load: 30 },
      { span: 2000, load: 18 },
    ],
    crossSection: buildParametricCrossSection({ width: 30, height: 60, slotWidth: 8 }),
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  // 示例停用条目：供后台演示"停用后新设计不可选"
  {
    id: 'ps-4040',
    code: '4040',
    series: '欧标4040',
    width: 40,
    height: 40,
    slotWidth: 10,
    slotDepth: 8,
    massPerMeter: 2.9,
    minCutLength: 40,
    maxCutLength: 3000,
    loadRatings: [
      { span: 1000, load: 80 },
      { span: 2000, load: 30 },
    ],
    crossSection: buildParametricCrossSection({ width: 40, height: 40, slotWidth: 10 }),
    enabled: false,
    updatedAt: UPDATED_AT,
  },
];

const connectors: Connector[] = [
  {
    id: 'cn-corner-6',
    name: '角码 6 系列（20 槽）',
    category: 'corner-bracket',
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'cn-corner-8',
    name: '角码 8 系列（30 槽）',
    category: 'corner-bracket',
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'cn-tbolt-6',
    name: 'T 型螺栓+螺母 6 系列（20 槽）',
    category: 't-bolt',
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'cn-tbolt-8',
    name: 'T 型螺栓+螺母 8 系列（30 槽）',
    category: 't-bolt',
    enabled: true,
    updatedAt: UPDATED_AT,
  },
];

/**
 * 兼容矩阵（连接件 × 规格组合）。
 * quantityPerJoint：每个连接点所需件数（角码每角 2 件为常用口径）。
 */
const compatibilities: Compatibility[] = [
  // 6 系列（20/2020、2040 槽宽 6）
  { id: 'cm-1', connectorId: 'cn-corner-6', profileCodeA: '2020', profileCodeB: '2020', quantityPerJoint: 2 },
  { id: 'cm-2', connectorId: 'cn-corner-6', profileCodeA: '2020', profileCodeB: '2040', quantityPerJoint: 2 },
  { id: 'cm-3', connectorId: 'cn-corner-6', profileCodeA: '2040', profileCodeB: '2040', quantityPerJoint: 2 },
  { id: 'cm-4', connectorId: 'cn-tbolt-6', profileCodeA: '2020', profileCodeB: '2020', quantityPerJoint: 1 },
  { id: 'cm-5', connectorId: 'cn-tbolt-6', profileCodeA: '2020', profileCodeB: '2040', quantityPerJoint: 1 },
  { id: 'cm-6', connectorId: 'cn-tbolt-6', profileCodeA: '2040', profileCodeB: '2040', quantityPerJoint: 1 },
  // 8 系列（3030、3060 槽宽 8）
  { id: 'cm-7', connectorId: 'cn-corner-8', profileCodeA: '3030', profileCodeB: '3030', quantityPerJoint: 2 },
  { id: 'cm-8', connectorId: 'cn-corner-8', profileCodeA: '3030', profileCodeB: '3060', quantityPerJoint: 2 },
  { id: 'cm-9', connectorId: 'cn-corner-8', profileCodeA: '3060', profileCodeB: '3060', quantityPerJoint: 2 },
  { id: 'cm-10', connectorId: 'cn-tbolt-8', profileCodeA: '3030', profileCodeB: '3030', quantityPerJoint: 1 },
  { id: 'cm-11', connectorId: 'cn-tbolt-8', profileCodeA: '3030', profileCodeB: '3060', quantityPerJoint: 1 },
  { id: 'cm-12', connectorId: 'cn-tbolt-8', profileCodeA: '3060', profileCodeB: '3060', quantityPerJoint: 1 },
];

const panelMaterials: PanelMaterial[] = [
  {
    id: 'pm-ply-15',
    name: '多层实木板',
    thicknesses: [9, 12, 15, 18],
    density: 0.55,
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'pm-mdf-18',
    name: '中密度纤维板',
    thicknesses: [12, 18],
    density: 0.75,
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'pm-acrylic-5',
    name: '亚克力板',
    thicknesses: [3, 5, 8],
    density: 1.2,
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'pm-alu-3',
    name: '铝板',
    thicknesses: [2, 3],
    density: 2.7,
    enabled: true,
    updatedAt: UPDATED_AT,
  },
];

const safetyRules: SafetyRule[] = [
  {
    id: 'sr-span',
    ruleType: 'max-unsupported-span',
    params: { maxSpan: 1500 },
    messageTemplate:
      '部件 {partId}（{specCode}）跨度 {span}mm 超过建议最大无支撑跨度 {maxSpan}mm，建议增加立柱或更换重载型材（如 3060）。',
    enabled: true,
    updatedAt: UPDATED_AT,
  },
  {
    id: 'sr-panel-load',
    ruleType: 'panel-span-load',
    params: { maxSpan: 900 },
    messageTemplate:
      '层板 {partId} 跨度 {span}mm 较大，超过建议值 {maxSpan}mm；长期承重请参考所选用材的承重表并考虑中部加立柱。',
    enabled: true,
    updatedAt: UPDATED_AT,
  },
];

/** 初始知识库快照（仅启用条目），供 `npm run seed` 与测试使用。 */
export function buildSeedCatalog(): CatalogSnapshot {
  return {
    profiles: profiles.filter((p) => p.enabled),
    connectors: connectors.filter((c) => c.enabled),
    compatibilities,
    panelMaterials: panelMaterials.filter((m) => m.enabled),
    safetyRules: safetyRules.filter((r) => r.enabled),
  };
}

/** 种子全集（含停用条目），供服务端 seed 脚本写入数据库。 */
export function buildSeedCatalogIncludingDisabled(): {
  profiles: ProfileSpec[];
  connectors: Connector[];
  compatibilities: Compatibility[];
  panelMaterials: PanelMaterial[];
  safetyRules: SafetyRule[];
} {
  return { profiles, connectors, compatibilities, panelMaterials, safetyRules };
}
