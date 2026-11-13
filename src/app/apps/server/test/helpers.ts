import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../dist/app.module';
import { loadConfig, type AppConfig } from '../dist/config/config';
import { LLM_ADAPTER_FACTORY } from '../dist/modules/ai/ai.service';
import { CATALOG_SERVICE } from '../dist/modules/catalog/catalog.module';
import { AUTH_SERVICE } from '../dist/modules/auth/auth.module';
import type { CatalogService } from '../dist/modules/catalog/catalog.service';
import type { AuthService } from '../dist/modules/auth/auth.service';
import type { LlmAdapter } from '@modatu/llm-adapter';
import { buildSeedCatalog, buildSeedCatalogIncludingDisabled } from '@modatu/catalog';

/**
 * 测试基座（接缝 2：HTTP API 边界）：
 * - 内存 sqljs 数据库（纯 WASM，无原生依赖），每个测试独立实例；
 * - 种子管理员 + 初始知识库（与生产 seed 同源数据）；
 * - LLM 适配器以假实现注入（接缝 4）。
 */

export const TEST_CONFIG: AppConfig = {
  ...loadConfig({
    MODATU_DB: 'sqljs',
    MODATU_SECRET: 'test-secret',
    MODATU_DEV_PASSWORD_LOGIN: 'true',
    NODE_ENV: 'test',
  }),
};

export interface TestHarness {
  app: INestApplication;
  server: ReturnType<typeof request>;
  close(): Promise<void>;
}

/** LLM 假适配器（canned response 脚本化，spec-06 测试决策）。 */
export class FakeLlmAdapter implements LlmAdapter {
  public calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  constructor(private readonly responses: Array<string | Error>) {}

  async complete(req: { messages: Array<{ role: string; content: string }> }) {
    this.calls.push({ messages: req.messages });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('FakeLlmAdapter: 无更多 canned 响应');
    return { text: next, model: 'fake-model' };
  }
}

export interface HarnessOptions {
  devPasswordLogin?: boolean;
  adapterFactory?: (config: { baseUrl: string; apiKey: string; model: string }) => LlmAdapter;
}

export async function createHarness(options: HarnessOptions = {}): Promise<TestHarness> {
  const config: AppConfig = {
    ...TEST_CONFIG,
    devPasswordLogin: options.devPasswordLogin ?? true,
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forConfig(config)],
  })
    .overrideProvider(LLM_ADAPTER_FACTORY)
    .useValue(options.adapterFactory ?? (() => new FakeLlmAdapter([])))
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();

  // 种子知识库（与 @modatu/catalog 种子同源；含停用条目 4040）
  const catalogService = app.get<CatalogService>(CATALOG_SERVICE as never);
  const seed = buildSeedCatalogIncludingDisabled();
  for (const p of seed.profiles) await catalogService.saveProfile({ ...p });
  for (const c of seed.connectors) await catalogService.saveConnector({ ...c });
  for (const c of seed.compatibilities)
    await catalogService.saveCompatibility({ ...c, id: c.id });
  for (const m of seed.panelMaterials) await catalogService.savePanelMaterial({ ...m });
  for (const r of seed.safetyRules) await catalogService.saveSafetyRule({ ...r });

  const server = request(app.getHttpServer());
  return { app, server, close: async () => void (await app.close()) };
}

/* ------------------------------- 种子/登录助手 ------------------------------- */

export const ADMIN_CREDENTIALS = { username: 'test-admin', password: 'admin-pass-123' };

/** 注册并登录一个用户，返回 Cookie 头。 */
export async function registerAndLogin(
  server: ReturnType<typeof request>,
  username: string,
  password = 'password-123',
): Promise<{ cookie: string; user: { id: string; nickname: string; role: string } }> {
  const res = await server
    .post('/api/auth/register')
    .send({ username, password })
    .expect(201);
  return { cookie: extractCookie(res), user: res.body };
}

export async function loginAs(
  server: ReturnType<typeof request>,
  username: string,
  password: string,
): Promise<string> {
  const res = await server.post('/api/auth/login/password').send({ username, password }).expect(201);
  return extractCookie(res);
}

export function extractCookie(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string;
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('响应没有 Set-Cookie');
  return raw.split(';')[0] as string;
}

/** 注册一个用户并提升为 admin（测试专用：通过 AuthService 的 userRepo 后门写入）。 */
export async function createAdmin(
  harness: TestHarness,
  credentials = ADMIN_CREDENTIALS,
): Promise<string> {
  const authService = harness.app.get<AuthService>(AUTH_SERVICE as never);
  const userRepo = authService.getUserRepository();
  const user = await authService.register(credentials);
  user.role = 'admin';
  await userRepo.save(user);
  return loginAs(harness.server, credentials.username, credentials.password);
}

/** 种子知识库快照（与 @modatu/catalog 种子一致，测试断言用）。 */
export function seedSnapshot() {
  return buildSeedCatalog();
}
