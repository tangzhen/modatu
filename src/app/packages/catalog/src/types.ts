/**
 * @modatu/catalog — 知识库领域类型（spec-01）
 *
 * 此包只定义"知识库条目对外读取接口"的数据形状与纯查询助手。
 * 持久化（PostgreSQL）与后台 CRUD 属于 apps/server；前端/AI/BOM
 * 一律通过本包的类型 + 服务端 `GET /catalog/*` 交互。
 */
import type { CrossSectionSource, ProfileCrossSection } from './cross-section';

/** 承重参考表：跨度（mm）→ 该跨度下推荐的均匀分布承重（kg）。 */
export interface LoadRating {
  /** 无支撑跨度，mm */
  span: number;
  /** 推荐承重，kg */
  load: number;
}

/** 型材规格（spec-01 实现决策：概念字段全集）。 */
export interface ProfileSpec {
  id: string;
  /** 规格代号，如 `3030`，设计模型通过 code 引用 */
  code: string;
  /** 系列，如 `欧标3030` */
  series: string;
  /** 截面宽，mm */
  width: number;
  /** 截面高，mm */
  height: number;
  /** 槽宽，mm */
  slotWidth: number;
  /** 槽深，mm */
  slotDepth: number;
  /** 单位长度质量，kg/m */
  massPerMeter: number;
  /** 允许切割长度下限，mm */
  minCutLength: number;
  /** 允许切割长度上限，mm */
  maxCutLength: number;
  /** 承重参考表（跨度→推荐承重） */
  loadRatings: LoadRating[];
  /** 基准米价（元/米，未税；对应本色），采集自厂家公开数据，可空 = 未采集 */
  pricePerMeter?: number | null;
  /** 各颜色米价（元/米，未税），key = ProfileFinish.id，可空 = 未采集 */
  finishPrices?: Record<string, number> | null;
  enabled: boolean;
  updatedAt: string;
  /** 精确截面（归一化多边形环，渲染器无关）。缺省时渲染层用参数化近似截面。 */
  crossSection?: ProfileCrossSection;
  /** 截面来源存档（后台导入的原文件，审计/重推导用；公共只读接口不下发） */
  crossSectionSource?: CrossSectionSource;
}

/** 型材颜色（表面处理）知识库条目：id 供设计模型 finishId 引用，colorHex 为 Modatu 自选的代表性渲染色。 */
export interface ProfileFinish {
  id: string;
  /** 稳定代号（ASCII），如 `natural` / `black` / `white` / `wood` */
  code: string;
  /** 显示名，如 `本色（喷砂氧化）` */
  name: string;
  /** 代表性渲染色（hex），非厂家贴图 */
  colorHex: string;
  enabled: boolean;
  updatedAt: string;
}

export type ConnectorCategory =
  /** 角码 */
  | 'corner-bracket'
  /** T 型螺栓/螺母 */
  | 't-bolt'
  /** 其他内置连接件（如三通） */
  | 'other';

/** 连接件目录条目。 */
export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  enabled: boolean;
  updatedAt: string;
}

/**
 * 连接兼容矩阵的一行："规格 A × 规格 B"可用某连接件，
 * 每个连接点需要 quantityPerJoint 件。方向对称（A×B 等价 B×A）。
 */
export interface Compatibility {
  id: string;
  connectorId: string;
  profileCodeA: string;
  profileCodeB: string;
  quantityPerJoint: number;
}

/** 板材材质（封板/桌面）。 */
export interface PanelMaterial {
  id: string;
  name: string;
  /** 常用厚度列表，mm */
  thicknesses: number[];
  /** 密度参考，g/cm³（面密度 = density × thickness） */
  density: number;
  enabled: boolean;
  updatedAt: string;
}

export type SafetyRuleType =
  /** 最大无支撑跨度 */
  | 'max-unsupported-span'
  /** 层板跨度承重提醒 */
  | 'panel-span-load';

/** 规则化安全规则（数据驱动，由 @modatu/safety-rules 求值）。 */
export interface SafetyRule {
  id: string;
  ruleType: SafetyRuleType;
  /** 规则参数（随 ruleType 而定），JSON 对象 */
  params: Record<string, number | string>;
  /** 提示文案模板，支持 {param} 插值 */
  messageTemplate: string;
  enabled: boolean;
  updatedAt: string;
}

/** 知识库快照：只读接口返回的启用条目集合，也是引用校验/BOM/AI 的输入。 */
export interface CatalogSnapshot {
  profiles: ProfileSpec[];
  connectors: Connector[];
  compatibilities: Compatibility[];
  panelMaterials: PanelMaterial[];
  safetyRules: SafetyRule[];
  /** 型材颜色条目（服务端总是下发；测试夹具可省略，此时 finishId 引用不做存在性校验） */
  finishes?: ProfileFinish[];
}

export const EMPTY_CATALOG: CatalogSnapshot = {
  profiles: [],
  connectors: [],
  compatibilities: [],
  panelMaterials: [],
  safetyRules: [],
};

/** 按代号查型材规格（仅启用条目）。 */
export function findProfile(catalog: CatalogSnapshot, code: string): ProfileSpec | undefined {
  return catalog.profiles.find((p) => p.code === code && p.enabled);
}

/** 按代号查型材规格（含停用条目，存量设计打开时使用）。 */
export function findProfileIncludingDisabled(catalog: CatalogSnapshot, code: string): ProfileSpec | undefined {
  return catalog.profiles.find((p) => p.code === code);
}

/** 按材质名查板材材质（仅启用）。 */
export function findPanelMaterial(catalog: CatalogSnapshot, id: string): PanelMaterial | undefined {
  return catalog.panelMaterials.find((m) => m.id === id && m.enabled);
}

/** 查连接件（仅启用）。 */
export function findConnector(catalog: CatalogSnapshot, id: string): Connector | undefined {
  return catalog.connectors.find((c) => c.id === id && c.enabled);
}

/** 查型材颜色（仅启用）。 */
export function findFinish(catalog: CatalogSnapshot, id: string): ProfileFinish | undefined {
  return catalog.finishes?.find((f) => f.id === id && f.enabled);
}

/** 型材米价：按颜色的价 → 基准价 → 未采集。 */
export function profilePricePerMeter(spec: ProfileSpec | undefined, finishId?: string): number | null {
  if (!spec) return null;
  if (finishId && spec.finishPrices && spec.finishPrices[finishId] !== undefined) {
    return spec.finishPrices[finishId] ?? null;
  }
  return spec.pricePerMeter ?? null;
}

/**
 * 查询"规格 A × 规格 B"可用的连接件行（方向对称）。
 * 仅返回连接件启用的行。
 */
export function findCompatibilities(
  catalog: CatalogSnapshot,
  codeA: string,
  codeB: string,
): Compatibility[] {
  return catalog.compatibilities.filter(
    (c) =>
      ((c.profileCodeA === codeA && c.profileCodeB === codeB) ||
        (c.profileCodeA === codeB && c.profileCodeB === codeA)) &&
      findConnector(catalog, c.connectorId) !== undefined,
  );
}

/** 两规格之间是否存在任何兼容连接件。 */
export function hasCompatibility(catalog: CatalogSnapshot, codeA: string, codeB: string): boolean {
  return findCompatibilities(catalog, codeA, codeB).length > 0;
}

/** 文案模板参数插值：`跨度 {span}mm` + {span: 900} → `跨度 900mm`。 */
export function interpolateTemplate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const value = params[key];
    return value === undefined ? `{${key}}` : String(value);
  });
}
