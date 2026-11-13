import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAdmin,
  createHarness,
  extractCookie,
  registerAndLogin,
  type TestHarness,
} from './helpers';

/**
 * spec-01 API 测试：只读接口可见性（仅启用条目）、后台权限（未登录/非 admin 被拒）、
 * 停用行为（只读不再返回、存量引用不报错在 designs 测试覆盖）、兼容矩阵查询语义。
 */
describe('Catalog & Admin API（spec-01）', () => {
  let harness: TestHarness;
  let adminCookie: string;
  let userCookie: string;

  beforeEach(async () => {
    harness = await createHarness();
    adminCookie = await createAdmin(harness);
    userCookie = await registerAndLogin(harness.server, 'normal-user').then((r) => r.cookie);
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('只读接口返回启用条目（种子中停用的 4040 不出现）', async () => {
    const { server } = harness;
    const profiles = await server.get('/api/catalog/profiles').expect(200);
    const codes = profiles.body.map((p: { code: string }) => p.code);
    expect(codes).toContain('3030');
    expect(codes).not.toContain('4040');
    expect(profiles.headers['content-type']).toContain('json');
  });

  it('后台列表包含停用条目（管理员可见全量）', async () => {
    const { server } = harness;
    const res = await server
      .get('/api/admin/catalog/profiles')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.map((p: { code: string }) => p.code)).toContain('4040');
  });

  it('后台接口权限：未登录 401、非 admin 403', async () => {
    const { server } = harness;
    await server.get('/api/admin/catalog/profiles').expect(401);
    await server
      .get('/api/admin/catalog/profiles')
      .set('Cookie', userCookie)
      .expect(403);
  });

  it('管理员新增型材规格并出现在只读接口', async () => {
    const { server } = harness;
    await server
      .put('/api/admin/catalog/profiles')
      .set('Cookie', adminCookie)
      .send({
        code: '2540',
        series: '欧标2540',
        width: 20,
        height: 40,
        slotWidth: 6,
        slotDepth: 5.2,
        massPerMeter: 0.9,
        minCutLength: 20,
        maxCutLength: 3000,
        loadRatings: [{ span: 1000, load: 18 }],
        enabled: true,
      })
      .expect(200);

    const profiles = await server.get('/api/catalog/profiles').expect(200);
    expect(profiles.body.map((p: { code: string }) => p.code)).toContain('2540');
  });

  it('管理员停用规格：只读接口立刻不可见', async () => {
    const { server } = harness;
    const profiles = await server.get('/api/admin/catalog/profiles').set('Cookie', adminCookie);
    const target = profiles.body.find((p: { code: string }) => p.code === '3030');
    await server
      .put(`/api/admin/catalog/profiles/${target.id}/enabled`)
      .set('Cookie', adminCookie)
      .send({ enabled: false })
      .expect(200);

    const publicProfiles = await server.get('/api/catalog/profiles').expect(200);
    expect(publicProfiles.body.map((p: { code: string }) => p.code)).not.toContain('3030');
  });

  it('兼容矩阵：随停用连接件隐藏；关键词搜索可用', async () => {
    const { server } = harness;
    const conn = await server
      .get('/api/admin/catalog/connectors')
      .set('Cookie', adminCookie)
      .expect(200);
    const corner8 = conn.body.find((c: { id: string }) => c.id === 'cn-corner-8');

    const before = await server.get('/api/catalog/connectors').expect(200);
    expect(before.body.compatibilities.length).toBeGreaterThan(0);

    await server
      .put(`/api/admin/catalog/connectors/${corner8.id}/enabled`)
      .set('Cookie', adminCookie)
      .send({ enabled: false })
      .expect(200);

    const after = await server.get('/api/catalog/connectors').expect(200);
    expect(
      after.body.compatibilities.some((c: { connectorId: string }) => c.connectorId === 'cn-corner-8'),
    ).toBe(false);

    const search = await server
      .get('/api/admin/catalog/profiles?q=2040')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(search.body.map((p: { code: string }) => p.code)).toEqual(['2040']);
  });

  it('保存兼容行：引用不存在的规格/连接件被拒', async () => {
    const { server } = harness;
    const res = await server
      .put('/api/admin/catalog/compatibilities')
      .set('Cookie', adminCookie)
      .send({
        connectorId: 'cn-corner-8',
        profileCodeA: '9999',
        profileCodeB: '3030',
        quantityPerJoint: 2,
      })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.message ?? res.body)).toContain('9999');
  });

  it('管理员封禁用户：登录被拒且既有会话失效；解封恢复', async () => {
    const { server } = harness;
    const { cookie } = await registerAndLogin(server, 'victim');
    const users = await server.get('/api/admin/users').set('Cookie', adminCookie).expect(200);
    const victim = users.body.find((u: { username: string }) => u.username === 'victim');
    expect(victim).toBeDefined();

    await server.post(`/api/admin/users/${victim.id}/ban`).set('Cookie', adminCookie).expect(201);

    // 既有会话立即失效
    await server.get('/api/auth/me').set('Cookie', cookie).expect(403);
    // 登录被拒
    const loginRes = await server
      .post('/api/auth/login/password')
      .send({ username: 'victim', password: 'password-123' })
      .expect(403);
    expect(loginRes.body.code).toBe('USER_BANNED');

    await server
      .post(`/api/admin/users/${victim.id}/unban`)
      .set('Cookie', adminCookie)
      .expect(201);
    await server
      .post('/api/auth/login/password')
      .send({ username: 'victim', password: 'password-123' })
      .expect(201);
  });

  it('用户管理接口对非 admin 拒绝', async () => {
    const { server } = harness;
    await server.get('/api/admin/users').set('Cookie', userCookie).expect(403);
  });

  it('新增安全规则并出现在只读接口（文案模板带参数）', async () => {
    const { server } = harness;
    await server
      .put('/api/admin/catalog/safety-rules')
      .set('Cookie', adminCookie)
      .send({
        ruleType: 'max-unsupported-span',
        params: { maxSpan: 1200 },
        messageTemplate: 'TEST-1200 跨度 {span}mm 超限 {maxSpan}mm',
        enabled: true,
      })
      .expect(200);

    const rules = await server.get('/api/catalog/safety-rules').expect(200);
    const added = rules.body.find((r: { messageTemplate: string }) =>
      r.messageTemplate.includes('TEST-1200'),
    );
    expect(added.params.maxSpan).toBe(1200);
  });
});
