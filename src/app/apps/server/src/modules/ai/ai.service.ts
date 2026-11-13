import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { UserEntity } from '../../db/entities/user.entity';
import { CatalogService } from '../catalog/catalog.service';
import { decryptString, encryptString, maskApiKey } from '../../common/crypto';
import { ApiException } from '../../common/errors';
import { LlmError, LlmAdapter, OpenAiCompatibleAdapter, extractJson, type OpenAiCompatibleConfig } from '@modatu/llm-adapter';
import { validateFull, diffModels, type DesignModel, type ValidationResult } from '@modatu/design-model';
import type { CatalogSnapshot } from '@modatu/catalog';
import { APP_CONFIG_TOKEN, type AppConfig } from '../../config/config';
import {
  aiResponseSchema,
  buildGenerateMessages,
  buildModifyMessages,
  buildRepairMessages,
  type AiProposal,
} from './prompts';

/** LLM 适配器注入令牌（测试用假实现覆盖，spec-06 接缝 4）。 */
export const LLM_ADAPTER_FACTORY = 'LLM_ADAPTER_FACTORY';

export type LlmAdapterFactory = (config: OpenAiCompatibleConfig) => LlmAdapter;

export const defaultAdapterFactory: LlmAdapterFactory = (config) =>
  new OpenAiCompatibleAdapter(config);

const MAX_ATTEMPTS = 3;

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly catalogService: CatalogService,
    @Inject(LLM_ADAPTER_FACTORY) private readonly adapterFactory: LlmAdapterFactory,
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
  ) {}

  /* ------------------------------ BYOK 设置 ------------------------------ */

  async getSettings(user: UserEntity): Promise<{
    configured: boolean;
    baseUrl: string | null;
    model: string | null;
    apiKeyMasked: string | null;
  }> {
    const fresh = await this.users.findOne({ where: { id: user.id } });
    const cfg = fresh?.aiConfig;
    if (!cfg) return { configured: false, baseUrl: null, model: null, apiKeyMasked: null };
    return {
      configured: true,
      baseUrl: decryptString(cfg.baseUrlEnc, this.secret) ?? null,
      model: cfg.model ?? null,
      apiKeyMasked: maskApiKey(decryptString(cfg.apiKeyEnc, this.secret)),
    };
  }

  async saveSettings(
    user: UserEntity,
    input: { baseUrl: string; apiKey?: string; model: string },
  ): Promise<void> {
    const fresh = await this.users.findOne({ where: { id: user.id } });
    if (!fresh) throw ApiException.notFound('用户不存在');
    const prevKey = decryptString(fresh.aiConfig?.apiKeyEnc ?? null, this.secret);
    const apiKey = input.apiKey && input.apiKey.length > 0 ? input.apiKey : prevKey;
    if (!apiKey) {
      throw ApiException.validation('API Key 未设置（首次配置必须提供）');
    }
    fresh.aiConfig = {
      baseUrlEnc: encryptString(input.baseUrl, this.secret),
      apiKeyEnc: encryptString(apiKey, this.secret),
      model: input.model,
    };
    await this.users.save(fresh);
  }

  async clearSettings(user: UserEntity): Promise<void> {
    const fresh = await this.users.findOne({ where: { id: user.id } });
    if (!fresh) return;
    fresh.aiConfig = null;
    await this.users.save(fresh);
  }

  private get secret(): string {
    return this.config.secret;
  }

  /* --------------------------- 生成 / 修改 --------------------------- */

  /** 从自然语言生成初始设计模型（不落库；应用走 designs 保存管道）。 */
  async generate(user: UserEntity, prompt: string): Promise<AiRunResult> {
    const catalog = await this.catalogService.snapshot();
    const adapter = await this.adapterFor(user);
    const baseMessages = buildGenerateMessages(prompt, catalog);
    return this.runValidated(adapter, baseMessages);
  }

  /**
   * 对现有模型做修改（spec-06）：LLM 输出全量 JSON；
   * diff 由系统侧对比新旧模型计算（不信任 LLM 自报 diff）。
   */
  async modify(user: UserEntity, current: DesignModel, instruction: string): Promise<AiRunResult> {
    const catalog = await this.catalogService.snapshot();
    const adapter = await this.adapterFor(user);
    const baseMessages = buildModifyMessages(current, instruction, catalog);
    const result = await this.runValidated(adapter, baseMessages);
    return { ...result, diff: diffModels(current, result.proposal.design) };
  }

  /** 纯校验端点（前端应用 AI 提案前的最终守门）。 */
  async validateModel(model: unknown): Promise<{ schema: ValidationResult; catalog: ValidationResult }> {
    const catalog = await this.catalogService.snapshot();
    const result = validateFull(model, catalog);
    return { schema: result.schema, catalog: result.catalog };
  }

  /* ------------------------------ 内部 ------------------------------ */

  private async adapterFor(user: UserEntity): Promise<LlmAdapter> {
    const fresh = await this.users.findOne({ where: { id: user.id } });
    const cfg = fresh?.aiConfig;
    const baseUrl = decryptString(cfg?.baseUrlEnc ?? null, this.secret);
    const apiKey = decryptString(cfg?.apiKeyEnc ?? null, this.secret);
    if (!cfg || !baseUrl || !apiKey || !cfg.model) {
      throw new ApiException('AI_NOT_CONFIGURED', HttpStatus.BAD_REQUEST, '请先在设置中配置 API 地址、Key 与模型名');
    }
    return this.adapterFactory({ baseUrl, apiKey, model: cfg.model });
  }

  /**
   * 输出校验与重试链（spec-06）：
   * LLM 输出 → 提取 JSON → Schema + 知识库引用校验 → 失败带错误反馈重试（最多 3 次）→
   * 仍失败则给用户可读错误，不静默降级。
   */
  private async runValidated(
    adapter: LlmAdapter,
    baseMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  ): Promise<AiRunResult> {
    const errors: string[] = [];
    let messages = [...baseMessages];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let text: string;
      try {
        const completion = await adapter.complete({ messages, temperature: attempt === 1 ? 0.2 : 0 });
        text = completion.text;
      } catch (err) {
        // 协议级错误（Key 无效/配额/网络）不做重试，直接透出。
        // 用 duck-typing 而非 instanceof：打包器/测试环境可能存在双份类定义。
        const code = (err as LlmError | undefined)?.code;
        const message = (err as Error | undefined)?.message;
        if (typeof code === 'string' && typeof message === 'string') {
          throw new ApiException('AI_OUTPUT_INVALID', HttpStatus.BAD_GATEWAY, `LLM 调用失败: ${message}`, {
            llmCode: code,
          });
        }
        throw err;
      }

      try {
        const raw = extractJson(text);
        const parsed = aiResponseSchema.parse(raw);
        const catalog = await this.catalogService.snapshot();
        const validation = validateFull(parsed.design, catalog);
        if (!validation.schema.ok || !validation.catalog.ok || !validation.design) {
          const issues = [
            ...validation.schema.issues.map((i) => `${i.path}: ${i.message}`),
            ...validation.catalog.issues.map((i) => `${i.path}: ${i.message}`),
          ];
          errors.push(`第 ${attempt} 次尝试校验失败: ${issues.slice(0, 5).join('；')}`);
          messages = buildRepairMessages(baseMessages, issues.slice(0, 8));
          continue;
        }
        return {
          proposal: { design: validation.design, unsatisfied: parsed.unsatisfied },
          diff: null,
          attempts: attempt,
          errors,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`第 ${attempt} 次尝试输出解析失败: ${message}`);
        messages = buildRepairMessages(baseMessages, [`输出不是合法的目标 JSON：${message}`]);
      }
    }

    throw new ApiException(
      'AI_OUTPUT_INVALID',
      HttpStatus.BAD_GATEWAY,
      `AI 输出连续 ${MAX_ATTEMPTS} 次未通过校验，请调整指令后重试`,
      { errors },
    );
  }
}

export interface AiRunResult {
  proposal: AiProposal;
  /** 系统侧计算的 diff（modify 时非空；generate 为 null） */
  diff: ReturnType<typeof diffModels> | null;
  attempts: number;
  errors: string[];
}
