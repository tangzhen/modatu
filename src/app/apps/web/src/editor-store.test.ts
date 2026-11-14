import { describe, expect, it, beforeEach } from 'vitest';
import { useEditor } from './stores/editor';
import { emptyDesign } from '@modatu/design-model';
import { buildSeedCatalog } from '@modatu/catalog';
import { EditorState } from '@modatu/editor-state';

/**
 * spec-04 组件测试面：交互层调用正确的状态层操作。
 * 不渲染 Three.js（渲染正确性走人工可视化验收），验证 store 与状态层的绑定。
 */

describe('编辑器 store ↔ 状态层绑定', () => {
  beforeEach(() => {
    const editor = new EditorState(emptyDesign('测试项目'), buildSeedCatalog());
    useEditor.setState({
      designId: null,
      catalog: buildSeedCatalog(),
      editor,
      model: editor.getModel(),
      selectedId: null,
      lastOpMessage: null,
      dirty: false,
      saveStatus: { state: 'guest' },
    });
  });

  it('addProfile 通过状态层校验并更新 model', () => {
    const r = useEditor.getState().addProfile({
      specCode: '3030',
      cutLength: 1800,
      position: { x: 0, y: 0, z: 0 },
      orientation: 'y',
    });
    expect(r.ok).toBe(true);
    expect(useEditor.getState().model.profiles).toHaveLength(1);
    expect(useEditor.getState().lastOpMessage).toBeNull();
  });

  it('非法操作被拒且 lastOpMessage 呈现原因（模型不变）', () => {
    const r = useEditor.getState().addProfile({
      specCode: '4040', // 停用规格
      cutLength: 100,
      position: { x: 0, y: 0, z: 0 },
      orientation: 'y',
    });
    expect(r.ok).toBe(false);
    expect(useEditor.getState().model.profiles).toHaveLength(0);
    expect(useEditor.getState().lastOpMessage).toContain('停用');
  });

  it('undo/redo 同步到 store model', () => {
    useEditor
      .getState()
      .addProfile({ specCode: '2040', cutLength: 400, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    expect(useEditor.getState().model.profiles).toHaveLength(1);
    useEditor.getState().undo();
    expect(useEditor.getState().model.profiles).toHaveLength(0);
    useEditor.getState().redo();
    expect(useEditor.getState().model.profiles).toHaveLength(1);
  });

  it('replaceModel（AI 应用入口）拒绝非法模型', () => {
    const bad = emptyDesign('坏模型');
    bad.profiles = [{ broken: true } as never];
    const r = useEditor.getState().replaceModel(bad, 'AI 修改');
    expect(r.ok).toBe(false);
    expect(useEditor.getState().model.profiles).toHaveLength(0);
  });

  it('安全提示数据链路（safety-rules 消费 store 的 catalog 与 model）', async () => {
    const { evaluateSafetyRules } = await import('@modatu/safety-rules');
    const catalog = buildSeedCatalog();
    const editor = new EditorState(
      {
        ...emptyDesign('长梁'),
        profiles: [
          { id: 'b', specCode: '2020', cutLength: 2200, position: { x: 0, y: 0, z: 0 }, orientation: 'x', connections: [] },
        ],
      },
      catalog,
    );
    useEditor.setState({ editor, model: editor.getModel(), catalog });
    expect(evaluateSafetyRules(useEditor.getState().model, catalog).length).toBeGreaterThan(0);
  });

  it('放置模式：startPlacement/换朝向/取消', () => {
    const s = useEditor.getState();
    expect(s.placement).toBeNull();
    s.startPlacement('3030');
    expect(useEditor.getState().placement).toEqual({ specCode: '3030', orientation: 'y' });
    useEditor.getState().setPlacementOrientation('x');
    expect(useEditor.getState().placement).toEqual({ specCode: '3030', orientation: 'x' });
    // 切换规格：不传朝向时默认 y（UI 层传入当前朝向以保留选择）
    useEditor.getState().startPlacement('2020');
    expect(useEditor.getState().placement).toEqual({ specCode: '2020', orientation: 'y' });
    useEditor.getState().cancelPlacement();
    expect(useEditor.getState().placement).toBeNull();
  });

  it('放置创建：placeProfile 走 addProfile（store 绑定）', () => {
    useEditor.getState().startPlacement('3030', 'y');
    const r = useEditor.getState().addProfile({
      specCode: '3030',
      cutLength: 640,
      position: { x: 100, y: 0, z: 200 },
      orientation: 'y',
    });
    expect(r.ok).toBe(true);
    const part = useEditor.getState().model.profiles[0];
    expect(part?.cutLength).toBe(640);
    expect(part?.position).toEqual({ x: 100, y: 0, z: 200 });
    expect(part?.orientation).toBe('y');
    // 放置模式保持（连续放置）
    expect(useEditor.getState().placement).toEqual({ specCode: '3030', orientation: 'y' });
  });

  it('setProfileFinish 更新部件颜色（经状态层校验）', () => {
    useEditor
      .getState()
      .addProfile({ specCode: '3030', cutLength: 500, position: { x: 0, y: 0, z: 0 }, orientation: 'y' });
    const id = useEditor.getState().model.profiles[0]!.id;
    // seed 快照无 finishes 条目 → 拒绝（存在性按快照判定）
    const r = useEditor.getState().setProfileFinish(id, 'finish-black');
    expect(r.ok).toBe(false);
  });
});
