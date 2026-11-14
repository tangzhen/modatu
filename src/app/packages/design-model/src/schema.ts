import { z } from 'zod';

/**
 * 结构化设计模型 Schema（spec-02，核心接缝）。
 *
 * - 单位统一 mm，一切长度（切割长度/尺寸/位置）对齐 0.5mm 精度。
 * - Schema 只负责"形状与数值合法"；知识库引用合法性（规格/连接件/材质
 *   存在且启用、兼容矩阵）由 `validateAgainstCatalog` 负责（见 validate.ts）。
 * - 服务端在保存与 AI 应用两个入口强制走这两个校验；前端编辑器状态层
 *   同样使用，保证"编辑器永远产不出非法模型"。
 */

export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];

export const PLANES = ['xy', 'xz', 'yz'] as const;
export type Plane = (typeof PLANES)[number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Meta {
  name: string;
  unit: 'mm';
  precision: 0.5;
}

/** 型材件：引用知识库启用的规格 + 切割长度 + 三维位置与朝向 + 连接件引用。 */
export interface ProfilePart {
  id: string;
  specCode: string;
  /** mm，正数，0.5 对齐，须在该规格允许切割范围内 */
  cutLength: number;
  /** 部件原点（最小角点），mm，0.5 对齐 */
  position: Vec3;
  /** 型材延伸轴 */
  orientation: Axis;
  /** 颜色（知识库 ProfileFinish.id），可空 = 默认本色；旧设计兼容字段 */
  finishId?: string;
  connections: Connection[];
}

/** 连接点：设计内两个型材件之间的一种连接件。 */
export interface Connection {
  connectorId: string;
  targetPartId: string;
}

/** 封板件：自由尺寸矩形板（材质/厚度/宽高/位置/所在平面）。 */
export interface PanelPart {
  id: string;
  materialId: string;
  /** mm，必须在所选材质的常用厚度列表内 */
  thickness: number;
  /** 板面内宽（u 轴），mm，正数，0.5 对齐 */
  width: number;
  /** 板面内高（v 轴），mm，正数，0.5 对齐 */
  height: number;
  position: Vec3;
  /** 板所在平面；厚度沿剩余轴。uv 轴映射：xy→(x,y)、xz→(x,z)、yz→(y,z) */
  plane: Plane;
}

export interface DesignModel {
  meta: Meta;
  profiles: ProfilePart[];
  panels: PanelPart[];
}

/** 校验错误（一条 = 一个位置 + 一个原因），稳定可序列化。 */
export interface DesignIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: DesignIssue[];
}

/* ------------------------------- 精度助手 ------------------------------- */

/** 0.5mm 对齐：v*2 为整数。避开浮点 modulo 陷阱。 */
export function isHalfMmAligned(v: number): boolean {
  return Number.isFinite(v) && Math.round(v * 2) === v * 2;
}

/** 对齐到 0.5mm（截断到最近 0.5）。 */
export function snapToHalfMm(v: number): number {
  return Math.round(v * 2) / 2;
}

/* -------------------------------- Schema -------------------------------- */

const halfMm = z
  .number()
  .finite()
  .refine(isHalfMmAligned, { message: '必须是 0.5mm 的整数倍（mm）' });

const positiveHalfMm = z
  .number()
  .finite()
  .positive({ message: '必须为正数（mm）' })
  .refine(isHalfMmAligned, { message: '必须是 0.5mm 的整数倍（mm）' });

const vec3Schema = z.object({
  x: halfMm,
  y: halfMm,
  z: halfMm,
});

const idSchema = z.string().min(1).max(64);

const connectionSchema = z.object({
  connectorId: idSchema,
  targetPartId: idSchema,
});

const profileSchema = z.object({
  id: idSchema,
  specCode: z.string().min(1).max(32),
  cutLength: positiveHalfMm,
  position: vec3Schema,
  orientation: z.enum(AXES),
  finishId: z.string().min(1).max(64).optional(),
  connections: z.array(connectionSchema).max(32).default([]),
});

const panelSchema = z.object({
  id: idSchema,
  materialId: idSchema,
  thickness: positiveHalfMm,
  width: positiveHalfMm,
  height: positiveHalfMm,
  position: vec3Schema,
  plane: z.enum(PLANES),
});

export const designModelSchema = z.object({
  meta: z.object({
    name: z.string().min(1).max(80),
    unit: z.literal('mm'),
    precision: z.literal(0.5),
  }),
  profiles: z.array(profileSchema).max(500),
  panels: z.array(panelSchema).max(500),
});

/** 深拷贝并应用 schema 默认值（connections: [] 等）。 */
export function normalizeDesign(raw: unknown): DesignModel {
  return designModelSchema.parse(raw) as DesignModel;
}

/** 空白设计。 */
export function emptyDesign(name = '未命名设计'): DesignModel {
  return { meta: { name, unit: 'mm', precision: 0.5 }, profiles: [], panels: [] };
}

/** 确定性序列化（键排序），用于"是否产生实质变更"的比较。 */
export function canonicalJson(model: DesignModel): string {
  return JSON.stringify(model, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(record).sort()) sorted[k] = record[k];
      return sorted;
    }
    return value;
  });
}

/* ------------------------------ Schema 校验 ------------------------------ */

function zodIssuesToDesignIssues(error: z.ZodError): DesignIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export interface SchemaParseResult extends ValidationResult {
  /** 校验通过时返回补全默认值后的模型 */
  design?: DesignModel;
}

/** Schema 解析：成功返回规范化模型，失败返回问题列表。 */
export function parseDesign(model: unknown): SchemaParseResult {
  const result = designModelSchema.safeParse(model);
  if (!result.success) {
    return { ok: false, issues: zodIssuesToDesignIssues(result.error) };
  }
  const design = result.data as DesignModel;
  const issues: DesignIssue[] = [];

  // 重复 id 检查（schema 表达不了跨元素唯一性）
  const seenIds = new Set<string>();
  for (const p of design.profiles) {
    if (seenIds.has(p.id)) issues.push({ path: `profiles.${p.id}`, message: '部件 id 重复' });
    seenIds.add(p.id);
  }
  for (const p of design.panels) {
    if (seenIds.has(p.id)) issues.push({ path: `panels.${p.id}`, message: '部件 id 重复' });
    seenIds.add(p.id);
  }

  // 连接指向的必须是本设计中的型材件（不能自连）
  const profileIds = new Set(design.profiles.map((p) => p.id));
  for (const p of design.profiles) {
    for (const c of p.connections) {
      if (c.targetPartId === p.id) {
        issues.push({
          path: `profiles.${p.id}.connections.${c.connectorId}`,
          message: '连接不能指向自身',
        });
      } else if (!profileIds.has(c.targetPartId)) {
        issues.push({
          path: `profiles.${p.id}.connections.${c.connectorId}`,
          message: `连接目标 ${c.targetPartId} 不是本设计中的型材件`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues, design };
}

/** 纯 Schema 校验（不含知识库引用校验）。 */
export function validateSchema(model: unknown): ValidationResult {
  const { ok, issues } = parseDesign(model);
  return { ok, issues };
}
