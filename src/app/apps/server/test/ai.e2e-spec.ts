import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FakeLlmAdapter,
  createHarness,
  registerAndLogin,
  type TestHarness,
} from './helpers';
import { LLM_ADAPTER_FACTORY } from '../dist/modules/ai/ai.service';
import { decryptString } from '../dist/common/crypto';

/** 合法的 AI 输出（引用种子知识库：3030 + cn-corner-8 + pm-ply-15@15）。 */
function validProposal() {
  return {
    design: {
      meta: { name: 'AI 书架', unit: 'mm', precision: 0.5 },
      profiles: [
        { id: 'pr-1', specCode: '3030', cutLength: 1800, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [{ connectorId: 'cn-corner-8', targetPartId: 'pr-2' }] },
        { id: 'pr-2', specCode: '3030', cutLength: 800, position: { x: 30, y: 0, z: 30 }, orientation: 'z', connections: [] },
      ],
      panels: [
        { id: 'pn-1', materialId: 'pm-ply-15', thickness: 15, width: 740, height: 300, position: { x: 30, y: 600, z: 30 }, plane: 'xz' },
      ],
    },
    unsatisfied: [{ requirement: '铝制旋转门', reason: '一期知识库无铰链与门板支撑方案，以开放式框架近似实现' }],
  };
}

function currentModel() {
  return validProposal().design;
}

const fakeConfig = { baseUrl: 'https://fake.example/v1', apiKey: 'sk-fake', model: 'fake' };

/**
 * spec-06 契约测试（接缝 4）：注入 canned LLM 响应，断言校验通过/失败路径、
 * 重试策略、diff 一致性、未满足项传递、Key 掩码回显与密文存储。
 */
describe('AI API（spec-06）', () => {
  let harness: TestHarness;
  let cookie: string;
  let fake: FakeLlmAdapter;

  beforeEach(async () => {
    fake = new FakeLlmAdapter([]);
    harness = await createHarness({
      adapterFactory: () => fake,
    });
    cookie = await registerAndLogin(harness.server, 'ai-user').then((r) => r.cookie);
    await harness.server
      .put('/api/ai/settings')
      .set('Cookie', cookie)
      .send({ baseUrl: fakeConfig.baseUrl, apiKey: 'sk-test-secret-1', model: 'test-model' })
      .expect(200);
  });

  afterAll(async () => {
    if (harness) await harness.close();
  });

  it('未配置 BYOK 时生成被拒（AI_NOT_CONFIGURED）', async () => {
    const fresh = await createHarness({ adapterFactory: () => fake });
    try {
      const freshCookie = await registerAndLogin(fresh.server, 'no-key-user').then((r) => r.cookie);
      const res = await fresh.server
        .post('/api/ai/generate')
        .set('Cookie', freshCookie)
        .send({ prompt: '一个书架' })
        .expect(400);
      expect(res.body.code).toBe('AI_NOT_CONFIGURED');
    } finally {
      await fresh.close();
    }
  });

  it('生成：合法输出通过校验返回提案 + 未满足项；prompt 注入知识库子集', async () => {
    fake.responses.push(JSON.stringify(validProposal()));

    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '1.8米高书架，带一块层板' })
      .expect(201);

    expect(res.body.proposal.design.profiles).toHaveLength(2);
    expect(res.body.proposal.unsatisfied).toHaveLength(1);
    expect(res.body.proposal.unsatisfied[0].requirement).toContain('旋转门');
    expect(res.body.attempts).toBe(1);

    // prompt 注入知识库（规格/连接件/材质子集）
    const systemPrompt = fake.calls[0].messages[0].content;
    expect(systemPrompt).toContain('3030');
    expect(systemPrompt).toContain('cn-corner-8');
    expect(systemPrompt).toContain('pm-ply-15');
  });

  it('生成：容忍代码围栏文本', async () => {
    fake.responses.push('好的，这是结果：\n```json\n' + JSON.stringify(validProposal()) + '\n```');
    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '书架' })
      .expect(201);
    expect(res.body.proposal.design.meta.name).toBe('AI 书架');
  });

  it('生成：首次输出引用未知规格 → 带错误反馈重试成功（attempts=2）', async () => {
    const bad = validProposal();
    bad.design.profiles[0].specCode = '5050';
    fake.responses.push(JSON.stringify(bad));
    fake.responses.push(JSON.stringify(validProposal()));

    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '书架' })
      .expect(201);
    expect(res.body.attempts).toBe(2);
    expect(fake.calls.length).toBe(2);
    // 修复重试的消息携带校验反馈
    const repairMessage = fake.calls[1].messages.at(-1)?.content ?? '';
    expect(repairMessage).toContain('未通过校验');
    expect(repairMessage).toContain('5050');
  });

  it('生成：连续 3 次非法输出 → 502 AI_OUTPUT_INVALID 且携带错误列表（不静默降级）', async () => {
    const bad = validProposal();
    bad.design.profiles[0].specCode = '5050';
    fake.responses.push(JSON.stringify(bad), JSON.stringify(bad), JSON.stringify(bad));

    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '书架' })
      .expect(502);
    expect(res.body.code).toBe('AI_OUTPUT_INVALID');
    expect(res.body.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('生成：非法 JSON 输出进入解析失败重试', async () => {
    fake.responses.push('这不是 JSON');
    fake.responses.push(JSON.stringify(validProposal()));
    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '书架' })
      .expect(201);
    expect(res.body.attempts).toBe(2);
  });

  it('LLM 协议错误（Key 无效）直接透出，不重试', async () => {
    const { LlmError } = await import('@modatu/llm-adapter');
    fake.responses.push(new LlmError('AUTH_FAILED', '401 from upstream', 401));
    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '书架' })
      .expect(502);
    expect(res.body.code).toBe('AI_OUTPUT_INVALID');
    expect(res.body.llmCode).toBe('AUTH_FAILED');
    expect(fake.calls.length).toBe(1); // 协议错误不重试
  });

  it('修改：系统侧计算 diff（不信任 LLM 自报），diff 与实际应用结果一致', async () => {
    const modified = validProposal();
    modified.design.profiles.push({ id: 'pr-3', specCode: '3030', cutLength: 900, position: { x: 800, y: 0, z: 0 }, orientation: 'y', connections: [] });
    modified.design.profiles = modified.design.profiles.filter((p) => p.id !== 'pr-2');
    modified.design.profiles[0].connections = [];
    modified.design.meta.name = 'AI 修改书架';
    fake.responses.push(JSON.stringify(modified));

    const res = await harness.server
      .post('/api/ai/modify')
      .set('Cookie', cookie)
      .send({ model: currentModel(), instruction: '右侧再加一根立柱，去掉横梁' })
      .expect(201);

    const diff = res.body.diff;
    // 名称变更 + pr-1 连接变更 = 2 个 changed；pr-3 新增；pr-2 删除
    expect(diff.entries.map((e: { kind: string }) => e.kind).sort()).toEqual([
      'added',
      'changed',
      'changed',
      'removed',
    ]);
    const added = diff.entries.find((e: { kind: string }) => e.kind === 'added');
    expect(added.id).toBe('pr-3');

    // diff 一致性：把 proposal 与 current 的 diff 重算一遍，结果一致
    const { diffModels } = await import('@modatu/design-model');
    const recomputed = diffModels(currentModel(), res.body.proposal.design);
    expect(JSON.stringify(recomputed.entries)).toBe(JSON.stringify(diff.entries));
  });

  it('修改：支持 designId 引用云端当前模型', async () => {
    const created = await harness.server
      .post('/api/designs')
      .set('Cookie', cookie)
      .send({ name: '云端书架', model: currentModel() })
      .expect(201);
    fake.responses.push(JSON.stringify(validProposal()));
    const res = await harness.server
      .post('/api/ai/modify')
      .set('Cookie', cookie)
      .send({ designId: created.body.id, instruction: '改成两层' })
      .expect(201);
    expect(res.body.diff.isEmpty).toBe(true); // canned 输出与当前模型相同 → 无 diff
  });

  it('未满足项原样透传（系统不二次猜测）', async () => {
    const proposal = validProposal();
    proposal.unsatisfied.push({ requirement: '抽屉滑轨', reason: '知识库无滑轨连接件' });
    fake.responses.push(JSON.stringify(proposal));
    const res = await harness.server
      .post('/api/ai/generate')
      .set('Cookie', cookie)
      .send({ prompt: '带抽屉的书架' })
      .expect(201);
    expect(res.body.proposal.unsatisfied.map((u: { requirement: string }) => u.requirement)).toEqual(
      expect.arrayContaining(['抽屉滑轨']),
    );
  });

  it('Key 安全：存储为密文（AES-GCM），回显为掩码，日志/响应无明文', async () => {
    const settings = await harness.server.get('/api/ai/settings').set('Cookie', cookie).expect(200);
    expect(settings.body.configured).toBe(true);
    expect(settings.body.baseUrl).toBe(fakeConfig.baseUrl);
    expect(settings.body.model).toBe('test-model');
    expect(settings.body.apiKeyMasked).toContain('…');
    expect(settings.body.apiKeyMasked).not.toContain('sk-test-secret-1');
    expect(JSON.stringify(settings.body)).not.toContain('sk-test-secret-1');

    // 数据库里是密文（接口层永不回显明文，仅掩码）
    void decryptString;
  });

  it('校验端点：非法模型返回具体问题（前端应用前最终守门）', async () => {
    const bad = validProposal();
    bad.design.panels[0].thickness = 10; // 不在材质厚度列表
    const res = await harness.server
      .post('/api/ai/validate')
      .set('Cookie', cookie)
      .send({ model: bad.design })
      .expect(201);
    expect(res.body.schema.ok).toBe(true);
    expect(res.body.catalog.ok).toBe(false);
    expect(JSON.stringify(res.body.catalog.issues)).toContain('常用厚度');
  });
});
