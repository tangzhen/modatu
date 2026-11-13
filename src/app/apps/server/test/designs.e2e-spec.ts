import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  extractCookie,
  registerAndLogin,
  type TestHarness,
} from './helpers';

/** 合法书架模型（3030 立柱 × 2 + 横梁 + 层板），引用种子知识库。 */
function shelfModel() {
  return {
    meta: { name: '书架', unit: 'mm', precision: 0.5 },
    profiles: [
      { id: 'col-1', specCode: '3030', cutLength: 1800, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [{ connectorId: 'cn-corner-8', targetPartId: 'rail-1' }] },
      { id: 'col-2', specCode: '3030', cutLength: 1800, position: { x: 800, y: 0, z: 0 }, orientation: 'y', connections: [] },
      { id: 'rail-1', specCode: '3030', cutLength: 800, position: { x: 30, y: 0, z: 30 }, orientation: 'z', connections: [] },
    ],
    panels: [
      { id: 'shelf-1', materialId: 'pm-ply-15', thickness: 15, width: 740, height: 300, position: { x: 30, y: 600, z: 30 }, plane: 'xz' },
    ],
  };
}

/**
 * spec-02 API 测试：设计 CRUD、Schema/引用校验拒绝、自动保存冲突（乐观锁）、
 * 版本列表与回退语义（前向追加）、软删除。
 */
describe('Designs & Versions API（spec-02）', () => {
  let harness: TestHarness;
  let cookie: string;

  beforeEach(async () => {
    harness = await createHarness();
    cookie = await registerAndLogin(harness.server, 'designer').then((r) => r.cookie);
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('创建 → 列表 → 读取', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '书架', model: shelfModel() })
      .expect(201);
    expect(created.body.version).toBe(1);
    expect(created.body.model.profiles).toHaveLength(3);

    const list = await server.get('/api/designs').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('书架');

    const got = await server
      .get(`/api/designs/${created.body.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(got.body.model.meta.name).toBe('书架');
  });

  it('空项目创建：版本 1 为空模型', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '空项目' })
      .expect(201);
    expect(created.body.model.profiles).toHaveLength(0);
    expect(created.body.model.panels).toHaveLength(0);
  });

  it('Schema 违规模型被拒（精度违规 + 问题明细）', async () => {
    const { server } = harness;
    const bad = shelfModel();
    bad.profiles[0].cutLength = 1800.25;
    const res = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '坏书架', model: bad })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.issues)).toContain('0.5mm');
  });

  it('引用停用规格（4040）被拒；未启用规格新设计不可选', async () => {
    const { server } = harness;
    const bad = shelfModel();
    bad.profiles[0].specCode = '4040';
    const res = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '停用引用', model: bad })
      .expect(422);
    expect(JSON.stringify(res.body.issues)).toContain('4040');
  });

  it('自动保存：乐观锁冲突返回 409 与当前模型', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '冲突书架', model: shelfModel() })
      .expect(201);

    // 标签页 A 以 baseVersion=1 保存
    const modelA = shelfModel();
    modelA.profiles[1].cutLength = 1700;
    const saveA = await server
      .put(`/api/designs/${created.body.id}/model`)
      .set('Cookie', cookie)
      .send({ model: modelA, baseVersion: 1 })
      .expect(200);
    expect(saveA.body.saved).toBe(true);
    expect(saveA.body.version).toBe(2);

    // 标签页 B 仍以 baseVersion=1 保存 → 409 + 当前模型（后写入者得到明确提示）
    const modelB = shelfModel();
    modelB.profiles[2].cutLength = 900;
    const conflict = await server
      .put(`/api/designs/${created.body.id}/model`)
      .set('Cookie', cookie)
      .send({ model: modelB, baseVersion: 1 })
      .expect(409);
    expect(conflict.body.code).toBe('VERSION_CONFLICT');
    expect(conflict.body.currentVersion).toBe(2);
    expect(conflict.body.currentModel.profiles[1].cutLength).toBe(1700);
  });

  it('相同模型重复保存不产生新版本', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '稳态书架', model: shelfModel() })
      .expect(201);
    const res = await server
      .put(`/api/designs/${created.body.id}/model`)
      .set('Cookie', cookie)
      .send({ model: shelfModel(), baseVersion: 1 })
      .expect(200);
    expect(res.body.saved).toBe(false);
    expect(res.body.newSeq).toBeNull();

    const versions = await server
      .get(`/api/designs/${created.body.id}/versions`)
      .set('Cookie', cookie)
      .expect(200);
    expect(versions.body).toHaveLength(1);
  });

  it('版本历史与回退：回退产生新版本（前向追加），历史不被改写', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '演进书架', model: shelfModel() })
      .expect(201);
    const id = created.body.id;

    const v2Model = shelfModel();
    v2Model.profiles.push({ id: 'col-3', specCode: '3030', cutLength: 1800, position: { x: 1600, y: 0, z: 0 }, orientation: 'y', connections: [] });
    await server
      .put(`/api/designs/${id}/model`)
      .set('Cookie', cookie)
      .send({ model: v2Model, baseVersion: 1, summary: '加了第三根立柱' })
      .expect(200);

    const versions = await server.get(`/api/designs/${id}/versions`).set('Cookie', cookie).expect(200);
    expect(versions.body.map((v: { seq: number }) => v.seq).sort()).toEqual([1, 2]);

    // 回退到版本 1
    const restore = await server
      .post(`/api/designs/${id}/versions/1/restore`)
      .set('Cookie', cookie)
      .send({ baseVersion: 2 })
      .expect(201);
    expect(restore.body.version).toBe(3);

    const after = await server.get(`/api/designs/${id}`).set('Cookie', cookie).expect(200);
    expect(after.body.model.profiles).toHaveLength(3); // 回到 v1 的 2 立柱 + 1 横梁

    // 历史仍完整：1、2、3
    const versionsAfter = await server
      .get(`/api/designs/${id}/versions`)
      .set('Cookie', cookie)
      .expect(200);
    expect(versionsAfter.body.map((v: { seq: number }) => v.seq).sort()).toEqual([1, 2, 3]);
    expect(versionsAfter.body.find((v: { seq: number }) => v.seq === 3).summary).toContain('回退到版本 1');
  });

  it('重命名与软删除', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '原名' })
      .expect(201);
    await server
      .patch(`/api/designs/${created.body.id}`)
      .set('Cookie', cookie)
      .send({ name: '新名' })
      .expect(200);
    const renamed = await server.get(`/api/designs/${created.body.id}`).set('Cookie', cookie);
    expect(renamed.body.name).toBe('新名');

    await server.delete(`/api/designs/${created.body.id}`).set('Cookie', cookie).expect(200);
    const list = await server.get('/api/designs').set('Cookie', cookie).expect(200);
    expect(list.body).toHaveLength(0);
    await server.get(`/api/designs/${created.body.id}`).set('Cookie', cookie).expect(404);
  });

  it('跨用户访问设计 → 404（不泄露存在性）', async () => {
    const { server } = harness;
    const created = await server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '私人设计' })
      .expect(201);
    const otherCookie = await registerAndLogin(server, 'intruder').then((r) => r.cookie);
    await server.get(`/api/designs/${created.body.id}`).set('Cookie', otherCookie).expect(404);
    await server
      .put(`/api/designs/${created.body.id}/model`)
      .set('Cookie', otherCookie)
      .send({ model: shelfModel(), baseVersion: 1 })
      .expect(404);
  });

  it('游客（未登录）创建设计被拒', async () => {
    const { server } = harness;
    await server.post('/api/designs').send({ name: '游客' }).expect(401);
  });
});
