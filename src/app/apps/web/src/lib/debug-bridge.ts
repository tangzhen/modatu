import { api } from '../api';
import { useEditor } from '../stores/editor';
import type { CatalogSnapshot } from '@modatu/catalog';
import type { Axis } from '@modatu/design-model';

/**
 * 开发期调试桥（仅 DEV 注册）：给自动化验收与控制台一条确定性命令通道。
 * 两条入口，同一套命令处理：
 * 1. window.__modatu.<cmd>() —— 控制台 / 主世界直接调用
 * 2. window.postMessage({ __mcmd: { id, cmd, args } }) —— 跨执行上下文（隔离 world），
 *    响应经 postMessage({ __mres: { id, ok, result } }) 回传。自动化 evaluate 与页面
 *    可能处于不同 world（DOM 共享、JS 全局隔离），postMessage 是唯一可靠的跨 world 通道，
 *    因此自动化断言一律走命令通道而不是读 window 全局。
 * 生产构建不注册。
 */

type Vec3 = { x: number; y: number; z: number };

interface CommandHandlers {
  [cmd: string]: (args: Record<string, unknown> | undefined) => unknown | Promise<unknown>;
}

function createHandlers(): CommandHandlers {
  return {
    /** 全量状态快照（断言用） */
    state: () => {
      const s = useEditor.getState();
      return {
        model: s.model,
        selectedIds: s.selectedIds,
        selectedId: s.selectedId,
        placement: s.placement,
        panelOpen: s.panelOpen,
        panelSection: s.panelSection,
        showShortcuts: s.showShortcuts,
        catalogProfiles: s.catalog.profiles.length,
        catalogEnabled: s.catalog.profiles.filter((p) => p.enabled).length,
        saveStatus: s.saveStatus,
        dirty: s.dirty,
        lastOpMessage: s.lastOpMessage,
        canUndo: s.editor?.canUndo() ?? false,
        canRedo: s.editor?.canRedo() ?? false,
      };
    },

    /** 重新拉取知识库（目录加载失败的自愈入口） */
    reloadCatalog: async () => {
      const catalog = (await api('/catalog')) as CatalogSnapshot;
      useEditor.getState().setCatalog(catalog);
      return catalog.profiles.length;
    },

    /** 重置为游客空模型（清空本地编辑） */
    reset: async () => {
      await useEditor.getState().open(null);
      return useEditor.getState().model.profiles.length;
    },

    /** 确定性放置型材（直接走 addProfile，不经 ghost 拖拽），返回新部件 id */
    place: (args) => {
      const { specCode, position, orientation } = args as {
        specCode: string;
        position: Vec3;
        orientation?: Axis;
      };
      const r = useEditor.getState().addProfile({ specCode, cutLength: 300, position, orientation: orientation ?? 'y' });
      if (!r.ok) throw new Error(r.reason);
      return useEditor.getState().model.profiles.at(-1)?.id ?? null;
    },

    /** 精确选中：id 数组为多选，null/undefined 清空 */
    select: (args) => {
      const { ids } = (args ?? {}) as { ids?: string[] | null };
      const s = useEditor.getState();
      s.select(null);
      if (ids) for (const id of ids) s.select(id, true);
      return useEditor.getState().selectedIds;
    },

    /** 多选对齐 */
    align: (args) => {
      const { axis, mode } = args as { axis: Axis; mode: 'min' | 'center' | 'max' };
      const r = useEditor.getState().alignSelected(axis, mode);
      if (!r.ok) throw new Error(r.reason);
      return useEditor.getState().selectedIds;
    },

    /** 多部件移动（走 moveParts 受约束操作） */
    moveParts: (args) => {
      const { updates } = args as { updates: Array<{ id: string; position: Vec3 }> };
      const r = useEditor.getState().moveParts(updates);
      if (!r.ok) throw new Error(r.reason);
      return true;
    },

    /** 删除全部选中部件 */
    removeSelected: () => {
      const r = useEditor.getState().deleteSelectedParts();
      if (!r.ok) throw new Error(r.reason);
      return true;
    },

    undo: () => {
      useEditor.getState().undo();
      return true;
    },
    redo: () => {
      useEditor.getState().redo();
      return true;
    },

    model: () => useEditor.getState().model,
  };
}

export function installDebugBridge(): void {
  if (!import.meta.env.DEV) return;
  if (typeof window === 'undefined') return;

  const handlers = createHandlers();

  // 主世界直接调用入口（控制台用）
  (window as unknown as Record<string, unknown>)['__modatu'] = handlers;

  // 跨 world 命令通道：postMessage 进 → 执行 → postMessage 出
  window.addEventListener('message', (e: MessageEvent) => {
    const data = e.data as { __mcmd?: { id: string; cmd: string; args?: Record<string, unknown> } } | undefined;
    if (!data || typeof data !== 'object' || !data.__mcmd) return;
    if (e.origin !== window.location.origin) return;
    const { id, cmd, args } = data.__mcmd;
    const handler = handlers[cmd];
    Promise.resolve()
      .then(() => {
        if (!handler) throw new Error(`未知命令: ${cmd}`);
        return handler(args);
      })
      .then((result) => {
        e.source?.postMessage({ __mres: { id, ok: true, result } }, { targetOrigin: '*' });
      })
      .catch((err: unknown) => {
        e.source?.postMessage(
          { __mres: { id, ok: false, error: err instanceof Error ? err.message : String(err) } },
          { targetOrigin: '*' },
        );
      });
  });
}
