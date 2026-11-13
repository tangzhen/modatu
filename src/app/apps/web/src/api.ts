/** API 访问层：统一 cookie 会话、统一错误码处理（spec-03：401 引导重新登录）。 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    status: number,
    message: string,
    readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? ((await res.json()) as Record<string, unknown>) : undefined;

  if (!res.ok) {
    const code = (data?.['code'] as string) ?? 'UNKNOWN';
    const message = (data?.['message'] as string) ?? res.statusText;
    throw new ApiError(code, res.status, message, data);
  }
  return data as T;
}

/** PDF 导出（二进制响应）。 */
export async function exportBomPdf(designId: string, model?: unknown): Promise<Blob> {
  const res = await fetch('/api/export/bom-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ designId, model }),
  });
  if (!res.ok) {
    let code = 'UNKNOWN';
    let message = res.statusText;
    try {
      const data = (await res.json()) as Record<string, unknown>;
      code = (data['code'] as string) ?? code;
      message = (data['message'] as string) ?? message;
    } catch {
      /* 非 JSON 错误体 */
    }
    throw new ApiError(code, res.status, message);
  }
  return res.blob();
}

export interface PublicUser {
  id: string;
  username: string | null;
  nickname: string;
  role: 'user' | 'admin';
}

export interface PublicConfig {
  devPasswordLogin: boolean;
  wechatLoginAvailable: boolean;
}

export interface DesignSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface DesignVersionDto {
  seq: number;
  summary: string;
  createdAt: string;
}

export interface DesignDto {
  id: string;
  userId: string;
  name: string;
  model: import('@modatu/design-model').DesignModel;
  version: number;
  updatedAt: string;
}

export interface VersionConflictError extends ApiError {
  currentVersion: number;
  currentModel: unknown;
}
