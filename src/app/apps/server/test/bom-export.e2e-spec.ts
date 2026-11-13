import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  extractCookie,
  registerAndLogin,
  type TestHarness,
} from './helpers';

function shelfModel() {
  return {
    meta: { name: '清单书架', unit: 'mm', precision: 0.5 },
    profiles: [
      { id: 'c1', specCode: '3030', cutLength: 1800, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [{ connectorId: 'cn-corner-8', targetPartId: 'r1' }, { connectorId: 'cn-tbolt-8', targetPartId: 'r2' }] },
      { id: 'c2', specCode: '3030', cutLength: 1800, position: { x: 800, y: 0, z: 0 }, orientation: 'y', connections: [] },
      { id: 'r1', specCode: '3030', cutLength: 1600, position: { x: 30, y: 0, z: 30 }, orientation: 'x', connections: [] },
      { id: 'r2', specCode: '3030', cutLength: 1600, position: { x: 30, y: 600, z: 30 }, orientation: 'x', connections: [] },
    ],
    panels: [
      { id: 'p1', materialId: 'pm-ply-15', thickness: 15, width: 1540, height: 300, position: { x: 30, y: 300, z: 30 }, plane: 'xz' },
      { id: 'p2', materialId: 'pm-ply-15', thickness: 15, width: 1540, height: 300, position: { x: 30, y: 900, z: 30 }, plane: 'xz' },
    ],
  };
}

/**
 * spec-05 API 测试：BOM 生成端点（合并计数/系数推导）与水印 PDF 导出
 * （文本层断言水印字段与关键行，不校验像素排版）。
 */
describe('BOM & PDF Export API（spec-05）', () => {
  let harness: TestHarness;
  let cookie: string;
  let designId: string;

  beforeEach(async () => {
    harness = await createHarness();
    cookie = await registerAndLogin(harness.server, 'exporter', 'password-123').then(
      (r) => r.cookie,
    );
    const created = await harness
      .server.post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '清单书架', model: shelfModel() })
      .expect(201);
    designId = created.body.id;
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('BOM 端点：同规格同长度合并、连接件按系数、板材合并', async () => {
    const { server } = harness;
    const res = await server
      .post(`/api/designs/${designId}/bom`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);

    expect(res.body.bom.profiles).toEqual([
      { specCode: '3030', cutLength: 1600, quantity: 2 },
      { specCode: '3030', cutLength: 1800, quantity: 2 },
    ]);
    expect(res.body.bom.connectors).toEqual([
      { connectorId: 'cn-corner-8', name: '角码 8 系列（30 槽）', quantity: 2 },
      { connectorId: 'cn-tbolt-8', name: 'T 型螺栓+螺母 8 系列（30 槽）', quantity: 1 },
    ]);
    expect(res.body.bom.panels).toHaveLength(1);
    expect(res.body.bom.panels[0].quantity).toBe(2);
  });

  it('BOM 不是存储快照：保存新模型后重新生成得到最新结果', async () => {
    const { server } = harness;
    const model = shelfModel();
    model.profiles[1].cutLength = 900;
    await server
      .put(`/api/designs/${designId}/model`)
      .set('Cookie', cookie)
      .send({ model, baseVersion: 1 })
      .expect(200);

    const res = await server
      .post(`/api/designs/${designId}/bom`)
      .set('Cookie', cookie)
      .send({})
      .expect(201);
    expect(res.body.bom.profiles.some((r: { cutLength: number }) => r.cutLength === 900)).toBe(true);
  });

  it('PDF 导出：登录用户可导出，文本层含水印（用户 ID/昵称/时间戳）与页脚标识', async () => {
    const { server } = harness;
    const me = await server.get('/api/auth/me').set('Cookie', cookie).expect(200);
    const nickname = me.body.nickname as string;

    const res = await server
      .post('/api/export/bom-pdf')
      .set('Cookie', cookie)
      .send({ designId })
      .expect(200)
      .expect('Content-Type', /application\/pdf/);

    const buffer = res.body as Buffer;
    expect(buffer.length).toBeGreaterThan(1000);

    // pdf-parse 验证文本层（spec-05 测试决策）
    const { createRequire } = await import('node:module');
    const require_ = createRequire(import.meta.url);
    const pdfParse = require_('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;
    const parsed = await pdfParse(buffer);
    const text = parsed.text;

    // 水印：昵称 + 时间戳（UserId 为 uuid 在文本层可能被断行，断言昵称与日期）
    expect(text).toContain(nickname);
    expect(text).toMatch(/20\d{2}-\d{2}-\d{2}/);
    // 页脚软件标识 + 标题
    expect(text).toContain('Modatu');
    expect(text).toContain('清单书架');
    // 关键 BOM 行
    expect(text).toContain('3030');
    expect(text).toContain('1600');
  });

  it('PDF 水印含用户 ID（uuid）', async () => {
    const { server } = harness;
    const me = await server.get('/api/auth/me').set('Cookie', cookie).expect(200);
    const userId = me.body.id;

    const res = await server
      .post('/api/export/bom-pdf')
      .set('Cookie', cookie)
      .send({ designId })
      .expect(200);

    const { createRequire } = await import('node:module');
    const pdfParse = createRequire(import.meta.url)('pdf-parse') as (b: Buffer) => Promise<{
      text: string;
    }>;
    const parsed = await pdfParse(res.body as Buffer);
    // 去掉空白与连字符后匹配 uuid 特征片段（文本层可能断行/换行）
    const compact = parsed.text.replace(/[\s-]+/g, '');
    const fragment = userId.replace(/-/g, '').slice(0, 12);
    expect(compact).toContain(fragment);
  });

  it('未登录导出被拒（水印需要身份）', async () => {
    const { server } = harness;
    await server.post('/api/export/bom-pdf').send({ designId }).expect(401);
  });

  it('导出他人设计被拒', async () => {
    const { server } = harness;
    const other = await registerAndLogin(server, 'someone-else').then((r) => r.cookie);
    await server
      .post('/api/export/bom-pdf')
      .set('Cookie', other)
      .send({ designId })
      .expect(404);
  });
});
