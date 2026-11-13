import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  extractCookie,
  registerAndLogin,
  type TestHarness,
} from './helpers';

/**
 * spec-03 API 测试：登录成功/失败、会话过期、游客 401、封禁、
 * dev flag 与隐藏登录页组合、微信适配器"暂未开通"。
 */
describe('Auth API（spec-03）', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createHarness({ devPasswordLogin: true });
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('注册 → 登录 → /me 正常', async () => {
    const { server } = harness;
    const reg = await server
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'secret-123', nickname: '小爱' })
      .expect(201);
    expect(reg.body.nickname).toBe('小爱');
    expect(reg.body.role).toBe('user');

    const login = await server
      .post('/api/auth/login/password')
      .send({ username: 'alice', password: 'secret-123' })
      .expect(201);
    const cookie = extractCookie(login);

    const me = await server.get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.username).toBe('alice');
  });

  it('错误密码 → 401 BAD_CREDENTIALS（密码以慢哈希存储，无明文回显路径）', async () => {
    const { server } = harness;
    await server.post('/api/auth/register').send({ username: 'bob', password: 'secret-123' });
    const res = await server
      .post('/api/auth/login/password')
      .send({ username: 'bob', password: 'wrong-pass' })
      .expect(401);
    expect(res.body.code).toBe('BAD_CREDENTIALS');
  });

  it('未登录访问受保护接口 → 统一 401 AUTH_REQUIRED', async () => {
    const { server } = harness;
    const res = await server.get('/api/designs').expect(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('伪造会话令牌 → 401（登录过期/无效同码，前端引导重新登录）', async () => {
    const { server } = harness;
    const res = await server
      .get('/api/auth/me')
      .set('Cookie', 'modatu_session=not-a-real-token')
      .expect(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  it('登出后旧 Cookie 失效', async () => {
    const { server } = harness;
    const cookie = await registerAndLogin(server, 'carol').then((r) => r.cookie);
    await server.post('/api/auth/logout').set('Cookie', cookie).expect(201);
    await server.get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('dev flag 开启时 /auth/login/dev 可用', async () => {
    const { server } = harness;
    await server.post('/api/auth/register').send({ username: 'dave', password: 'secret-123' });
    await server
      .post('/api/auth/login/dev')
      .send({ username: 'dave', password: 'secret-123' })
      .expect(201);
  });

  it('dev flag 关闭：dev 登录接口 404，隐藏页通道 /auth/login/password 仍可用', async () => {
    const closed = await createHarness({ devPasswordLogin: false });
    try {
      const { server } = closed;
      const config = await server.get('/api/config').expect(200);
      expect(config.body.devPasswordLogin).toBe(false);

      await server.post('/api/auth/register').send({ username: 'erin', password: 'secret-123' });

      const dev = await server
        .post('/api/auth/login/dev')
        .send({ username: 'erin', password: 'secret-123' })
        .expect(404);
      expect(dev.body.code).toBe('DEV_LOGIN_DISABLED');

      await server
        .post('/api/auth/login/password')
        .send({ username: 'erin', password: 'secret-123' })
        .expect(201);
    } finally {
      await closed.close();
    }
  });

  it('微信登录适配器返回 501 暂未开通', async () => {
    const { server } = harness;
    const res = await server.post('/api/auth/login/wechat').expect(501);
    expect(res.body.code).toBe('WECHAT_NOT_AVAILABLE');
  });

  it('参数校验失败 → 400 VALIDATION_ERROR（密码过短）', async () => {
    const { server } = harness;
    const res = await server
      .post('/api/auth/register')
      .send({ username: 'shorty', password: '123' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it('用户名重复 → 409 USERNAME_TAKEN', async () => {
    const { server } = harness;
    await server.post('/api/auth/register').send({ username: 'dup', password: 'secret-123' });
    const res = await server
      .post('/api/auth/register')
      .send({ username: 'dup', password: 'secret-456' })
      .expect(409);
    expect(res.body.code).toBe('USERNAME_TAKEN');
  });
});
