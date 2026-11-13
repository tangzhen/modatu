import { interpolateTemplate, type CatalogSnapshot, type SafetyRule } from '@modatu/catalog';
import type { DesignModel } from '@modatu/design-model';

/**
 * 规则化安全提示求值（spec-01：规则为数据驱动；spec-04：编辑器消费本求值函数，
 * 在属性面板/提示条展示，非阻塞警告，不阻止保存）。
 *
 * 一期不做精确力学计算——只做"规则类型 + JSON 参数 + 文案模板"的表驱动检查：
 * - max-unsupported-span：水平延伸的型材（orientation ≠ y）长度超过 maxSpan 提示。
 * - panel-span-load：封板板面内最长边超过 maxSpan 提醒查承重表。
 */

export interface SafetyHint {
  ruleId: string;
  partId: string;
  partKind: 'profile' | 'panel';
  message: string;
}

export function evaluateSafetyRules(
  design: DesignModel,
  catalog: CatalogSnapshot,
): SafetyHint[] {
  const hints: SafetyHint[] = [];
  const rules = catalog.safetyRules.filter((r) => r.enabled);

  for (const rule of rules) {
    switch (rule.ruleType) {
      case 'max-unsupported-span':
        hints.push(...evalUnsupportedSpan(rule, design));
        break;
      case 'panel-span-load':
        hints.push(...evalPanelSpanLoad(rule, design));
        break;
      default:
        // 未知规则类型：跳过（数据来自后台，可扩展新类型而不破坏求值器）
        break;
    }
  }

  return hints;
}

function evalUnsupportedSpan(rule: SafetyRule, design: DesignModel): SafetyHint[] {
  const maxSpan = Number(rule.params['maxSpan']);
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) return [];

  const hints: SafetyHint[] = [];
  for (const p of design.profiles) {
    // 立柱（y 向延伸）天然被层板支撑，不算"无支撑跨度"
    if (p.orientation === 'y') continue;
    if (p.cutLength > maxSpan) {
      hints.push({
        ruleId: rule.id,
        partId: p.id,
        partKind: 'profile',
        message: interpolateTemplate(rule.messageTemplate, {
          partId: p.id,
          specCode: p.specCode,
          span: p.cutLength,
          maxSpan,
        }),
      });
    }
  }
  return hints;
}

function evalPanelSpanLoad(rule: SafetyRule, design: DesignModel): SafetyHint[] {
  const maxSpan = Number(rule.params['maxSpan']);
  if (!Number.isFinite(maxSpan) || maxSpan <= 0) return [];

  const hints: SafetyHint[] = [];
  for (const p of design.panels) {
    const span = Math.max(p.width, p.height);
    if (span > maxSpan) {
      hints.push({
        ruleId: rule.id,
        partId: p.id,
        partKind: 'panel',
        message: interpolateTemplate(rule.messageTemplate, {
          partId: p.id,
          span,
          maxSpan,
        }),
      });
    }
  }
  return hints;
}
