import { buildSeedCatalog } from '@modatu/catalog';
import type { DesignModel } from '@modatu/design-model';
import { beforeEach, describe, expect, it } from 'vitest';
import { EditorState, __resetPartIdCounter } from '../src';

function base(): DesignModel {
  return {
    meta: { name: '书架', unit: 'mm', precision: 0.5 },
    profiles: [
      { id: 'col-1', specCode: '3030', cutLength: 1800, position: { x: 0, y: 0, z: 0 }, orientation: 'y', connections: [] },
      { id: 'rail-1', specCode: '3030', cutLength: 800, position: { x: 0, y: 0, z: 30 }, orientation: 'x', connections: [] },
    ],
    panels: [
      { id: 'shelf-1', materialId: 'pm-ply-15', thickness: 15, width: 740, height: 300, position: { x: 30, y: 600, z: 30 }, plane: 'xz' },
    ],
  };
}

describe('受约束编辑器状态层', () => {
  beforeEach(() => __resetPartIdCounter());
  const catalog = buildSeedCatalog();

  it('初始模型必须合法', () => {
    const bad = base();
    (bad.profiles[0] as unknown as Record<string, unknown>).cutLength = 'x';
    expect(() => new EditorState(bad, catalog)).toThrow();
  });

  it('添加型材：合法规格通过，停用规格被拒且模型不变', () => {
    const s = new EditorState(base(), catalog);
    const ok = s.addProfile({ specCode: '2040', cutLength: 500, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    expect(ok.ok).toBe(true);
    expect(s.getModel().profiles).toHaveLength(3);
    expect(s.getModel().profiles[2]?.cutLength).toBe(500); // 0.5 对齐保持

    const before = s.getModel();
    const rejected = s.addProfile({ specCode: '4040', cutLength: 500, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toContain('停用');
    expect(s.getModel()).toEqual(before);
  });

  it('切割长度超范围被拒', () => {
    const s = new EditorState(base(), catalog);
    const r = s.addProfile({ specCode: '3030', cutLength: 5000, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('允许范围');
  });

  it('位置自动 0.5 对齐', () => {
    const s = new EditorState(base(), catalog);
    s.addProfile({ specCode: '3030', cutLength: 600, position: { x: 100.3, y: 0, z: 20 }, orientation: 'z' });
    expect(s.getModel().profiles[2]?.position.x).toBe(100.5);
  });

  it('resize/changeSpec 拒绝路径', () => {
    const s = new EditorState(base(), catalog);
    expect(s.resizeProfile('col-1', 5000).ok).toBe(false);
    expect(s.resizeProfile('nope', 500).ok).toBe(false);
    // 换 2020：长度 1800 在范围内但 rail-1 的连接将失效 —— 先给 col-1 加一条与 rail-1 的连接
    s.addConnection('col-1', 'cn-corner-8', 'rail-1');
    const r = s.changeSpec('col-1', '2020');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不兼容');
  });

  it('changeSpec 成功路径与撤销', () => {
    const s = new EditorState(base(), catalog);
    expect(s.changeSpec('rail-1', '3060').ok).toBe(true); // 3060 允许 30-3000
    expect(s.getModel().profiles[1]?.specCode).toBe('3060');
    s.undo();
    expect(s.getModel().profiles[1]?.specCode).toBe('3030');
  });

  it('连接：兼容检查、重复拒绝、删除', () => {
    const s = new EditorState(base(), catalog);
    expect(s.addConnection('col-1', 'cn-corner-8', 'rail-1').ok).toBe(true);
    expect(s.addConnection('col-1', 'cn-corner-8', 'rail-1').ok).toBe(false); // 重复
    expect(s.addConnection('col-1', 'cn-corner-6', 'rail-1').ok).toBe(false); // 6系角码不兼容3030×3030
    expect(s.addConnection('col-1', 'cn-corner-8', 'col-1').ok).toBe(false); // 自连
    expect(s.getModel().profiles[0]?.connections).toHaveLength(1);
    expect(s.removeConnection('col-1', 'cn-corner-8', 'rail-1').ok).toBe(true);
    expect(s.getModel().profiles[0]?.connections).toHaveLength(0);
  });

  it('removeProfile 清理指向它的连接', () => {
    const s = new EditorState(base(), catalog);
    s.addConnection('col-1', 'cn-corner-8', 'rail-1');
    s.removeProfile('rail-1');
    expect(s.getModel().profiles).toHaveLength(1);
    expect(s.getModel().profiles[0]?.connections).toHaveLength(0);
  });

  it('封板：厚度必须在材质列表内', () => {
    const s = new EditorState(base(), catalog);
    const bad = s.addPanel({ materialId: 'pm-ply-15', thickness: 10, width: 500, height: 300, position: { x: 0, y: 0, z: 0 }, plane: 'xz' });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('常用厚度');
    const ok = s.addPanel({ materialId: 'pm-ply-15', thickness: 12, width: 500.4, height: 300, position: { x: 0.4, y: 0, z: 0 }, plane: 'xz' });
    expect(ok.ok).toBe(true);
    const p = s.getModel().panels[1]!;
    expect(p.thickness).toBe(12);
    expect(p.width).toBe(500.5);
  });

  it('面板尺寸/材质调整与拒绝', () => {
    const s = new EditorState(base(), catalog);
    expect(s.resizePanel('shelf-1', { width: 800, height: 350 }).ok).toBe(true);
    expect(s.resizePanel('shelf-1', { thickness: 20 }).ok).toBe(false); // 20 不在多层实木板列表
    expect(s.setPanelMaterial('shelf-1', 'pm-acrylic-5').ok).toBe(false); // 15mm 不在亚克力列表
    expect(s.resizePanel('shelf-1', { thickness: 12 }).ok).toBe(true);
    expect(s.setPanelMaterial('shelf-1', 'pm-mdf-18').ok).toBe(true); // 12 在 MDF 列表
  });

  it('撤销/重做：成功操作入栈，被拒操作不入栈', () => {
    const s = new EditorState(base(), catalog);
    s.addProfile({ specCode: '2040', cutLength: 400, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    s.addProfile({ specCode: '2040', cutLength: 600, position: { x: 100, y: 0, z: 0 }, orientation: 'x' });
    expect(s.getModel().profiles).toHaveLength(4);
    s.addProfile({ specCode: '4040', cutLength: 400, position: { x: 0, y: 0, z: 0 }, orientation: 'x' }); // 被拒
    s.undo();
    expect(s.getModel().profiles).toHaveLength(3);
    s.undo();
    expect(s.getModel().profiles).toHaveLength(2);
    s.redo();
    expect(s.getModel().profiles).toHaveLength(3);
    expect(s.canRedo()).toBe(true); // 还可继续重做到第 4 件
    s.redo();
    expect(s.getModel().profiles).toHaveLength(4);
    expect(s.canRedo()).toBe(false);
    expect(s.canUndo()).toBe(true);
  });

  it('重命名', () => {
    const s = new EditorState(base(), catalog);
    expect(s.setModelName('  新名字  ').ok).toBe(true);
    expect(s.getModel().meta.name).toBe('新名字');
    expect(s.setModelName('').ok).toBe(false);
  });

  it('replaceModel：AI 应用入口整体校验，非法模型被拒', () => {
    const s = new EditorState(base(), catalog);
    const illegal = base();
    illegal.profiles[0]!.specCode = '5050';
    const before = s.getModel();
    const r = s.replaceModel(illegal, 'AI 修改');
    expect(r.ok).toBe(false);
    expect(s.getModel()).toEqual(before);

    const legal = base();
    legal.profiles.push({ id: 'col-2', specCode: '3030', cutLength: 1800, position: { x: 800, y: 0, z: 0 }, orientation: 'y', connections: [] });
    expect(s.replaceModel(legal, 'AI 修改').ok).toBe(true);
    expect(s.getModel().profiles).toHaveLength(3);
    s.undo();
    expect(s.getModel().profiles).toHaveLength(2);
  });

  it('diffAgainst 计算与当前模型的差异', () => {
    const s = new EditorState(base(), catalog);
    const snapshot = s.getModel();
    s.resizeProfile('rail-1', 900);
    const diff = s.diffAgainst(snapshot);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]?.kind).toBe('changed');
  });

  it('订阅通知在变更时触发', () => {
    const s = new EditorState(base(), catalog);
    let count = 0;
    const unsub = s.subscribe(() => (count += 1));
    s.addProfile({ specCode: '2040', cutLength: 400, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    expect(count).toBe(1);
    // 被拒操作不通知
    s.addProfile({ specCode: '4040', cutLength: 400, position: { x: 0, y: 0, z: 0 }, orientation: 'x' });
    expect(count).toBe(1);
    unsub();
    s.undo();
    expect(count).toBe(1);
  });
});
