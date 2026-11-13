import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LlmError,
  OpenAiCompatibleAdapter,
  extractJson,
  joinUrl,
  type ChatCompletionResponse,
} from '../src';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const adapter = new OpenAiCompatibleAdapter({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
});

describe('LLM Adapter（OpenAI 兼容）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('配置不全抛 CONFIG_INVALID', () => {
    expect(
      () =>
        new OpenAiCompatibleAdapter({ baseUrl: '', apiKey: 'k', model: 'm' }),
    ).toThrowError(LlmError);
  });

  it('POST {base}/chat/completions 并携带 Bearer 头', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: 'hello' } }],
        model: 'test-model',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } satisfies ChatCompletionResponse),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('hello');
    expect(result.model).toBe('test-model');
    expect(result.usage?.promptTokens).toBe(10);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('baseUrl 尾斜杠被规范化', () => {
    expect(joinUrl('https://x.com/v1///', '/chat/completions')).toBe(
      'https://x.com/v1/chat/completions',
    );
  });

  it('401 → AUTH_FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));
    await expect(adapter.complete({ messages: [] })).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
  });

  it('429 → QUOTA_EXCEEDED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, {})));
    await expect(adapter.complete({ messages: [] })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
  });

  it('500 → UPSTREAM_ERROR 且透出 error.message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: 'boom' } })),
    );
    const err = await adapter.complete({ messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe('UPSTREAM_ERROR');
    expect(err.message).toContain('boom');
  });

  it('网络失败 → NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(adapter.complete({ messages: [] })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
  });

  it('响应缺 content → UPSTREAM_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { choices: [] })));
    await expect(adapter.complete({ messages: [] })).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
  });

  it('extractJson 容忍代码围栏与杂文本', () => {
    expect(extractJson('前缀```json\n{"a":1}\n```后缀')).toEqual({ a: 1 });
    expect(extractJson('说明文字 {"b":[1,2]} 结尾')).toEqual({ b: [1, 2] });
    expect(() => extractJson('完全没有 JSON')).toThrowError(LlmError);
  });
});
