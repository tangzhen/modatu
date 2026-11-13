import { create } from 'zustand';
import {
  EditorState,
  newPartId,
  type OpResult,
  type PanelInput,
  type ProfileInput,
} from '@modatu/editor-state';
import { emptyDesign, type DesignModel } from '@modatu/design-model';
import type { CatalogSnapshot } from '@modatu/catalog';
import { EMPTY_CATALOG } from '@modatu/catalog';
import { api, type DesignDto, ApiError } from '../api';

/**
 * 编辑器 store：包装 @modatu/editor-state（模型状态层，spec-04 决策的解耦边界）。
 * 渲染层（Viewer3D）只读本 store 的 model，不直接改模型。
 */

export type SaveStatus =
  | { state: 'guest' }
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; version: number }
  | { state: 'conflict'; currentVersion: number; message: string }
  | { state: 'error'; message: string };

interface EditorStore {
  /** 云端设计 id（游客模式为 null） */
  designId: string | null;
  catalog: CatalogSnapshot;
  model: DesignModel;
  editor: EditorState | null;
  selectedId: string | null;
  lastOpMessage: string | null;
  saveStatus: SaveStatus;
  dirty: boolean;

  /** 初始化（打开云端设计或游客空模型） */
  open: (designId: string | null) => Promise<void>;
  setCatalog: (catalog: CatalogSnapshot) => void;
  select: (id: string | null) => void;

  addProfile: (input: ProfileInput) => OpResult;
  removeProfile: (id: string) => OpResult;
  moveProfile: (id: string, position: { x: number; y: number; z: number }) => OpResult;
  resizeProfile: (id: string, cutLength: number) => OpResult;
  changeSpec: (id: string, specCode: string) => OpResult;
  addConnection: (profileId: string, connectorId: string, targetPartId: string) => OpResult;
  removeConnection: (profileId: string, connectorId: string, targetPartId: string) => OpResult;
  addPanel: (input: PanelInput) => OpResult;
  removePanel: (id: string) => OpResult;
  movePanel: (id: string, position: { x: number; y: number; z: number }) => OpResult;
  resizePanel: (id: string, dims: { thickness?: number; width?: number; height?: number }) => OpResult;
  setPanelMaterial: (id: string, materialId: string) => OpResult;
  rename: (name: string) => OpResult;
  undo: () => void;
  redo: () => void;
  /** AI 应用入口：全量替换（走状态层同一管道，保证撤销栈一致） */
  replaceModel: (model: DesignModel, description: string) => OpResult;

  /** 自动保存（防抖由调用方控制；乐观锁冲突进入 conflict 状态） */
  save: (summary?: string) => Promise<void>;
  resetConflict: () => void;
  /** 冲突后刷新：拉取当前版本作为新基线（保留本地编辑由用户手动取舍） */
  reloadServerModel: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 1200;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditor = create<EditorStore>((set, get) => {
  function applyOp(op: () => OpResult): OpResult {
    const editor = get().editor;
    if (!editor) return { ok: false, reason: '编辑器未初始化' };
    const result = op();
    if (result.ok) {
      set({ model: editor.getModel(), lastOpMessage: null, dirty: get().designId !== null });
      scheduleSave(get, set);
    } else {
      set({ lastOpMessage: result.reason ?? '操作被拒绝' });
    }
    return result;
  }

  function scheduleSave(get: () => EditorStore, set: (partial: Partial<EditorStore>) => void) {
    if (get().designId === null) return; // 游客不保存
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveStatus: { state: 'idle' } });
    saveTimer = setTimeout(() => void get().save(), SAVE_DEBOUNCE_MS);
  }

  return {
    designId: null,
    catalog: EMPTY_CATALOG,
    model: emptyDesign(),
    editor: null,
    selectedId: null,
    lastOpMessage: null,
    saveStatus: { state: 'guest' },
    dirty: false,

    open: async (designId) => {
      const catalog = await api<CatalogSnapshot>('/catalog/all').catch(() => EMPTY_CATALOG);
      let model = emptyDesign();
      let version: number | undefined;
      if (designId) {
        const design = await api<DesignDto>(`/designs/${designId}`);
        model = design.model;
        version = design.version;
      }
      const editor = new EditorState(model, catalog);
      set({
        designId,
        catalog,
        editor,
        model: editor.getModel(),
        selectedId: null,
        lastOpMessage: null,
        dirty: false,
        saveStatus: designId
          ? { state: 'saved', version: version ?? 1 }
          : { state: 'guest' },
      });
    },

    setCatalog: (catalog) => set({ catalog }),

    select: (id) => set({ selectedId: id }),

    addProfile: (input) => applyOp(() => get().editor!.addProfile(input)),
    removeProfile: (id) => applyOp(() => get().editor!.removeProfile(id)),
    moveProfile: (id, position) => applyOp(() => get().editor!.moveProfile(id, position)),
    resizeProfile: (id, cutLength) => applyOp(() => get().editor!.resizeProfile(id, cutLength)),
    changeSpec: (id, specCode) => applyOp(() => get().editor!.changeSpec(id, specCode)),
    addConnection: (profileId, connectorId, targetPartId) =>
      applyOp(() => get().editor!.addConnection(profileId, connectorId, targetPartId)),
    removeConnection: (profileId, connectorId, targetPartId) =>
      applyOp(() => get().editor!.removeConnection(profileId, connectorId, targetPartId)),
    addPanel: (input) => applyOp(() => get().editor!.addPanel(input)),
    removePanel: (id) => applyOp(() => get().editor!.removePanel(id)),
    movePanel: (id, position) => applyOp(() => get().editor!.movePanel(id, position)),
    resizePanel: (id, dims) => applyOp(() => get().editor!.resizePanel(id, dims)),
    setPanelMaterial: (id, materialId) => applyOp(() => get().editor!.setPanelMaterial(id, materialId)),
    rename: (name) => applyOp(() => get().editor!.setModelName(name)),
    undo: () => {
      const editor = get().editor;
      if (!editor) return;
      editor.undo();
      set({ model: editor.getModel() });
    },
    redo: () => {
      const editor = get().editor;
      if (!editor) return;
      editor.redo();
      set({ model: editor.getModel() });
    },
    replaceModel: (model, description) =>
      applyOp(() => get().editor!.replaceModel(model, description)),

    save: async () => {
      const { designId, editor, model, saveStatus } = get();
      if (!designId || !editor) return;
      const baseVersion = saveStatus.state === 'saved' ? saveStatus.version : 1;
      set({ saveStatus: { state: 'saving' } });
      try {
        const summary = editor.describeLastChange() || '手动编辑';
        const result = await api<{ saved: boolean; version: number; newSeq: number | null }>(
          `/designs/${designId}/model`,
          { method: 'PUT', body: { model, baseVersion, summary } },
        );
        set({ saveStatus: { state: 'saved', version: result.version }, dirty: false });
      } catch (err) {
        if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
          set({
            saveStatus: {
              state: 'conflict',
              currentVersion: (err.body?.['currentVersion'] as number) ?? 0,
              message: err.message,
            },
          });
        } else if (err instanceof ApiError && err.code === 'AUTH_REQUIRED') {
          set({ saveStatus: { state: 'guest' } });
        } else if (err instanceof ApiError && err.code === 'DESIGN_INVALID') {
          set({ saveStatus: { state: 'error', message: err.message } });
        } else {
          set({ saveStatus: { state: 'error', message: String(err) } });
        }
      }
    },

    resetConflict: () => set({ saveStatus: { state: 'idle' } }),

    reloadServerModel: async () => {
      const { designId } = get();
      if (!designId) return;
      const design = await api<DesignDto>(`/designs/${designId}`);
      const editor = new EditorState(design.model, get().catalog);
      set({
        editor,
        model: editor.getModel(),
        selectedId: null,
        dirty: false,
        saveStatus: { state: 'saved', version: design.version },
      });
    },
  };
});

export { newPartId };
