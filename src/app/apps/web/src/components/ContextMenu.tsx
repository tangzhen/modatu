import { useEffect, useRef, type CSSProperties } from 'react';

export interface ContextMenuItem {
  /** 分组标题（渲染为不可点的小节头）；有 section 时忽略 label/onClick */
  section?: string;
  label?: string;
  key?: string;
  danger?: boolean;
  onClick?: () => void;
}

/**
 * 画布右键 context 菜单（多选 ≥2 时触发）：对齐 X/Y/Z + 删除。
 * 点击菜单外任意处或 Esc 关闭。
 */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // 视口内收放：贴边翻转
  const style: CSSProperties = { left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 320) };

  return (
    <div ref={ref} className="ctx-menu" style={style} role="menu" aria-label="对齐菜单">
      {items.map((item, i) =>
        item.section ? (
          <div key={`s${i}`} className="ctx-sec">
            {item.section}
          </div>
        ) : (
          <button
            type="button"
            key={`i${i}`}
            role="menuitem"
            className={`ctx-item${item.danger ? ' danger' : ''}`}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
          >
            {item.label}
            {item.key && <kbd className="kbd">{item.key}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
