import { z } from 'zod';
import type { CatalogSnapshot, Compatibility, Connector, PanelMaterial, ProfileSpec } from '@modatu/catalog';
import type { DesignModel } from '@modatu/design-model';

/**
 * LLM prompt 构造（spec-06：知识库子集注入 prompt，把模型输出限定在合法集合内）。
 * Prompt 细节实施期迭代，这里锁定输入/输出契约：
 * - 输出必须是 JSON：{ design: DesignModel, unsatisfied: [{requirement, reason}] }
 */

export interface AiUnsatisfiedItem {
  requirement: string;
  reason: string;
}

export interface AiProposal {
  design: DesignModel;
  unsatisfied: AiUnsatisfiedItem[];
}

export const aiResponseSchema = z.object({
  design: z.unknown(),
  unsatisfied: z
    .array(
      z.object({
        requirement: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .default([]),
});

/** 目录子集的紧凑文本表示（控制 token 成本：只注入编辑器/AI 需要的字段）。 */
export function renderCatalogForPrompt(catalog: CatalogSnapshot): string {
  const lines: string[] = [];

  lines.push('## 可用型材规格（只允许引用这些 code）');
  for (const p of catalog.profiles as ProfileSpec[]) {
    lines.push(
      `- ${p.code}: 截面 ${p.width}×${p.height}mm, 槽宽 ${p.slotWidth}mm, 切割长度 ${p.minCutLength}-${p.maxCutLength}mm, 承重参考 ${renderLoads(p)}`,
    );
  }

  lines.push('');
  lines.push('## 可用连接件与兼容矩阵（只允许引用这些 connectorId）');
  const byConnector = new Map<string, Connector>();
  for (const c of catalog.connectors as Connector[]) byConnector.set(c.id, c);
  const compatByConnector = new Map<string, Compatibility[]>();
  for (const row of catalog.compatibilities as Compatibility[]) {
    const list = compatByConnector.get(row.connectorId) ?? [];
    list.push(row);
    compatByConnector.set(row.connectorId, list);
  }
  for (const [id, connector] of byConnector) {
    const pairs = (compatByConnector.get(id) ?? [])
      .map((r) => `${r.profileCodeA}×${r.profileCodeB}(每接点${r.quantityPerJoint}件)`)
      .join(', ');
    lines.push(`- ${id}「${connector.name}」: ${pairs || '（无兼容记录）'}`);
  }

  lines.push('');
  lines.push('## 可用板材材质（只允许引用这些 materialId 与列出的厚度）');
  for (const m of catalog.panelMaterials as PanelMaterial[]) {
    lines.push(`- ${m.id}「${m.name}」: 厚度 ${m.thicknesses.join('/')}mm`);
  }

  return lines.join('\n');
}

function renderLoads(p: ProfileSpec): string {
  if (p.loadRatings.length === 0) return '无';
  return p.loadRatings.map((r) => `${r.span}mm→${r.load}kg`).join(', ');
}

const DESIGN_CONTRACT = `输出严格 JSON（不要输出 JSON 以外的说明文字），结构如下：
{
  "design": {
    "meta": { "name": "项目名", "unit": "mm", "precision": 0.5 },
    "profiles": [
      {
        "id": "pr-1",
        "specCode": "3030",
        "cutLength": 1800,
        "position": { "x": 0, "y": 0, "z": 0 },
        "orientation": "y",
        "connections": [ { "connectorId": "cn-corner-8", "targetPartId": "pr-2" } ]
      }
    ],
    "panels": [
      { "id": "pn-1", "materialId": "pm-ply-15", "thickness": 15, "width": 740, "height": 300,
        "position": { "x": 30, "y": 600, "z": 30 }, "plane": "xz" }
    ]
  },
  "unsatisfied": [ { "requirement": "用户要求原文", "reason": "为什么无法满足及近似实现说明" } ]
}

硬性规则：
1. 所有长度单位 mm，且必须是 0.5 的整数倍。
2. specCode / connectorId / materialId 只能取自下方知识库清单；厚度必须在材质厚度列表内。
3. cutLength 必须在规格允许的切割长度范围内。
4. connections 中 connectorId 必须与两侧型材规格存在兼容记录；targetPartId 必须是本设计中的型材件 id；不允许自连。
5. 无法满足的要求不要静默忽略：写进 unsatisfied，并给出尽量合理的近似实现。
6. position 是部件原点（最小角点）。型材 orientation 为其延伸方向；板材 plane 为所在平面（厚度沿第三轴）。`;

export function buildGenerateMessages(prompt: string, catalog: CatalogSnapshot) {
  return [
    {
      role: 'system' as const,
      content: `你是铝型材家具设计助手。用户会用自然语言描述想要的家具，你输出结构化设计模型 JSON。\n${DESIGN_CONTRACT}\n\n知识库（唯一合法数据源）：\n${renderCatalogForPrompt(catalog)}`,
    },
    { role: 'user' as const, content: prompt },
  ];
}

export function buildModifyMessages(
  current: DesignModel,
  instruction: string,
  catalog: CatalogSnapshot,
) {
  return [
    {
      role: 'system' as const,
      content: `你是铝型材家具设计助手。你会收到当前设计模型 JSON 与一条修改指令，输出修改后的完整设计模型 JSON（全量替换，不做局部 patch）。\n${DESIGN_CONTRACT}\n\n知识库（唯一合法数据源）：\n${renderCatalogForPrompt(catalog)}`,
    },
    {
      role: 'user' as const,
      content: `当前设计模型：\n${JSON.stringify(current, null, 2)}\n\n修改指令：${instruction}`,
    },
  ];
}

/** 校验失败后的修复重试消息（spec-06 失败策略：带错误反馈的修复提示）。 */
export function buildRepairMessages(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  issues: string[],
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: '（上一次输出）',
    },
    {
      role: 'user' as const,
      content: `你的输出未通过校验，问题如下：\n${issues.map((i) => `- ${i}`).join('\n')}\n请修正后重新输出完整 JSON（仍然只输出 JSON）。`,
    },
  ];
}
