import { IconMaximize, IconMousePointer, IconPlus, IconSparkles, IconTable } from './icons';

/**
 * 画布底部居中的浮动工具栏（Figma UI3 风格，深色胶囊）。
 * 「选择」激活时退出放置模式（取消型材 ghost 选择），可在画布内点选/拖拽/调长；
 * 「放置」打开工具轨的型材库分区选择规格。
 */
export interface EditorToolbarProps {
  /** 是否处于放置模式（ghost 跟随中） */
  placing: boolean;
  /** F2 徽章模式：在带快捷键的图标上显示按键 */
  showShortcuts: boolean;
  onExitPlacement: () => void;
  onOpenLibrary: () => void;
  onFitView: () => void;
  onOpenBom: () => void;
  onOpenAi: () => void;
}

export function EditorToolbar({
  placing,
  showShortcuts,
  onExitPlacement,
  onOpenLibrary,
  onFitView,
  onOpenBom,
  onOpenAi,
}: EditorToolbarProps) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="编辑器工具栏">
      <button
        type="button"
        className={`tool-btn${!placing ? ' active' : ''}`}
        title="选择（V）"
        aria-label="选择工具（V）"
        aria-pressed={!placing}
        onClick={onExitPlacement}
      >
        <IconMousePointer size={17} />
        {showShortcuts && <span className="key-badge">V</span>}
      </button>
      <button
        type="button"
        className={`tool-btn${placing ? ' active' : ''}`}
        title="放置型材"
        aria-label="放置型材"
        aria-pressed={placing}
        onClick={onOpenLibrary}
      >
        <IconPlus size={17} />
      </button>
      <button type="button" className="tool-btn" title="适配视图（回到默认机位）" aria-label="适配视图" onClick={onFitView}>
        <IconMaximize size={17} />
      </button>
      <span className="tool-div" />
      <button type="button" className="tool-btn" title="清单（BOM）" aria-label="清单 BOM" data-testid="open-bom" onClick={onOpenBom}>
        <IconTable size={17} />
      </button>
      <button type="button" className="tool-btn" title="AI 生成/修改" aria-label="AI 生成或修改" data-testid="open-ai" onClick={onOpenAi}>
        <IconSparkles size={17} />
      </button>
    </div>
  );
}
