import { IconClose } from './icons';

/**
 * 快捷键速查表（F2 / ? 切换显示）：带按键徽章的轻量浮层，悬浮于底部工具栏上方。
 */
export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts-pop" role="dialog" aria-label="快捷键速查表" data-testid="shortcuts-overlay">
      <div className="shortcuts-head">
        <strong>快捷键</strong>
        <span className="hint">
          <kbd className="kbd">F2</kbd> 显示 / 隐藏
        </span>
        <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>
      <div className="sc-grid">
        <div className="sc-group">
          <div className="sc-title">工具</div>
          <div className="sc-row">
            <span>选择工具（退出放置）</span>
            <span className="sc-keys"><kbd className="kbd">V</kbd></span>
          </div>
          <div className="sc-row">
            <span>退出放置 / 取消</span>
            <span className="sc-keys"><kbd className="kbd">Esc</kbd></span>
          </div>
          <div className="sc-row">
            <span>删除选中部件</span>
            <span className="sc-keys"><kbd className="kbd">Del</kbd></span>
          </div>
        </div>
        <div className="sc-group">
          <div className="sc-title">部件编辑</div>
          <div className="sc-row">
            <span>调长 −10 / +10 mm</span>
            <span className="sc-keys"><kbd className="kbd">[</kbd><kbd className="kbd">]</kbd></span>
          </div>
          <div className="sc-row">
            <span>移动 X / Z</span>
            <span className="sc-keys"><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd><kbd className="kbd">←</kbd><kbd className="kbd">→</kbd></span>
          </div>
          <div className="sc-row">
            <span>调高度 ±10 mm</span>
            <span className="sc-keys"><kbd className="kbd">PgUp</kbd><kbd className="kbd">PgDn</kbd></span>
          </div>
          <div className="sc-row">
            <span>拖拽时 1mm 步进（按住）</span>
            <span className="sc-keys"><kbd className="kbd">Shift</kbd></span>
          </div>
        </div>
        <div className="sc-group">
          <div className="sc-title">视图</div>
          <div className="sc-row">
            <span>旋转 / 平移 / 缩放</span>
            <span className="sc-keys"><kbd className="kbd">左键拖</kbd><kbd className="kbd">中键拖</kbd><kbd className="kbd">滚轮</kbd></span>
          </div>
        </div>
        <div className="sc-group">
          <div className="sc-title">界面</div>
          <div className="sc-row">
            <span>快捷键速查表</span>
            <span className="sc-keys"><kbd className="kbd">F2</kbd><kbd className="kbd">?</kbd></span>
          </div>
          <div className="sc-row">
            <span>重命名设计</span>
            <span className="sc-keys"><span className="sc-mouse">双击设计名</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}
