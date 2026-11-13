/**
 * LLM Adapter 统一接口（spec-06 接缝 4）。
 *
 * - 上层（服务端 AiService）只依赖本接口；自动化测试注入假实现（canned response），
 *   绝不依赖真实网络。
 * - 一期仅 OpenAI 兼容协议实现（base_url + key + model）。
 * - 本包不做 JSON 解析/校验/重试——那是上层（AI 应用链路）的职责，本包只负责
 *   "把消息发出去、把文本拿回来"与协议级错误转换。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatJsonRequest {
  messages: ChatMessage[];
  /** JSON 输出模式（OpenAI 兼容 response_format），实现可尽力而为 */
  temperature?: number;
  /** 超时毫秒，默认 60000 */
  timeoutMs?: number;
}

export interface LlmCompletion {
  /** 助手返回的原始文本 */
  text: string;
  /** 实际使用的模型名 */
  model: string;
  /** token 用量（OpenAI 兼容 usage 字段，缺失则 unknown） */
  usage?: { promptTokens?: number; completionTokens?: number };
}

export type LlmErrorCode =
  | 'CONFIG_INVALID'
  | 'AUTH_FAILED'
  | 'QUOTA_EXCEEDED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UPSTREAM_ERROR';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmAdapter {
  /** 发送一轮 chat 请求并返回原始文本。 */
  complete(req: ChatJsonRequest): Promise<LlmCompletion>;
}

/* ----------------------- OpenAI 兼容实现 ----------------------- */

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string; type?: string; code?: string | number };
}

export class OpenAiCompatibleAdapter implements LlmAdapter {
  constructor(private readonly config: OpenAiCompatibleConfig) {
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new LlmError('CONFIG_INVALID', 'base_url / api key / model 三要素必须齐全');
    }
  }

  async complete(req: ChatJsonRequest): Promise<LlmCompletion> {
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? 60000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const url = joinUrl(this.config.baseUrl, '/chat/completions');
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: req.messages,
          temperature: req.temperature ?? 0.2,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        throw new LlmError('TIMEOUT', `LLM 请求超时（${timeoutMs}ms）`);
      }
      throw new LlmError('NETWORK_ERROR', `无法连接 LLM 服务: ${messageOf(err)}`);
    }
    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      throw new LlmError('AUTH_FAILED', 'API Key 无效或无权限', response.status);
    }
    if (response.status === 429) {
      throw new LlmError('QUOTA_EXCEEDED', '配额不足或请求过于频繁', response.status);
    }
    if (!response.ok) {
      const body = (await safeJson(response)) as { error?: { message?: string } } | null;
      throw new LlmError(
        'UPSTREAM_ERROR',
        `LLM 服务返回 ${response.status}: ${body?.error?.message ?? response.statusText}`,
        response.status,
      );
    }

    const data = (await safeJson(response)) as ChatCompletionResponse | null;
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new LlmError('UPSTREAM_ERROR', 'LLM 响应缺少 choices[0].message.content');
    }
    return {
      text,
      model: data?.model ?? this.config.model,
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
      },
    };
  }
}

/* ------------------------------- 助手 ------------------------------- */

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

export async function safeJson(response: Response): Promise<unknown | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 从 LLM 文本中提取 JSON（容忍 ```json 代码围栏与前后杂文本）。 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new LlmError('UPSTREAM_ERROR', '响应中没有找到 JSON');
  const opener = candidate[start]!;
  const closer = opener === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(closer);
  if (end <= start) throw new LlmError('UPSTREAM_ERROR', 'JSON 不完整');
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}
