import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { useEditor, ORIENTATIONS } from '../stores/editor';
import { Viewer3D, type Viewer3DHandle } from '../components/Viewer3D';
import { PartsPanel } from '../components/PartsPanel';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { ContextMenu } from '../components/ContextMenu';
import { BomModal } from '../components/BomModal';
import { VersionsDrawer } from '../components/VersionsDrawer';
import { AiPanel } from '../components/AiPanel';
import { EditorToolbar } from '../components/EditorToolbar';
import { HelpModal } from '../components/HelpModal';
import { IconFolder, IconHelp, IconHistory, IconLogOut, IconRedo, IconShield, IconUndo } from '../components/icons';

/** 编辑器主界面（spec-04 + v2 UI）：浮动 chrome + 工具轨/浮动面板 + 画布 + 属性面板。 */
export function EditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const {
    designId,
    model,
    catalog,
    open,
    select,
    selectedIds,
    moveParts,
    alignSelected,
    deleteSelectedParts,
    beginGesture,
    endGesture,
    moveProfile,
    movePanel,
    setProfileExtent,
    undo,
    redo,
    editor,
    saveStatus,
    lastOpMessage,
    reloadServerModel,
    placement,
    setPlacementOrientation,
    cancelPlacement,
    openPanel,
    addProfile,
    showShortcuts,
  } = useEditor();

  const [modal, setModal] = useState<'bom' | 'versions' | 'ai' | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [leaveWarning, setLeaveWarning] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const viewerRef = useRef<Viewer3DHandle>(null);
  /** 离开守卫：用户确认放弃后放行下一次后退 */
  const leaveGuardArmedRef = useRef(true);

  useEffect(() => {
    // 游客访问云端设计 URL → 引导登录
    if (id && !user) {
      navigate(`/login?next=/editor/${id}`);
      return;
    }
    setLoaded(false);
    open(id ?? null)
      .then(() => setLoaded(true))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [id, user, open, navigate]);

  useEffect(() => {
    if (!loaded) return;
    /** 是否存在未保存的编辑：云端 dirty 或游客模式下已有部件 */
    const hasUnsaved = () => {
      const s = useEditor.getState();
      const guestContent = s.designId === null && (s.model.profiles.length > 0 || s.model.panels.length > 0);
      return Boolean(s.dirty) || guestContent;
    };
    // 关闭/刷新（真实 unload）：浏览器原生确认
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsaved()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    // SPA 后退（含 Edge 鼠标手势的"返回"手势）：哨兵条目拦截，先询问
    const sentinel = { modatuLeaveGuard: true };
    window.history.pushState(sentinel, '');
    const onPopState = () => {
      if (!leaveGuardArmedRef.current || !hasUnsaved()) return;
      window.history.pushState(sentinel, ''); // 留在编辑器
      setLeaveWarning(true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
    };
  }, [loaded]);

  /** 放弃未保存编辑并离开（守卫放行一次后退） */
  const discardAndLeave = () => {
    setLeaveWarning(false);
    leaveGuardArmedRef.current = false;
    window.history.back();
  };

  // 页面级快捷键（参考 Figma 惯例）：V 选择工具、F2/? 图标按键徽章、Delete/Backspace 删除选中部件。
  // 输入框聚焦时全部让位给文本编辑。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      const s = useEditor.getState();
      if (e.key === 'F2' || (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        s.toggleShortcuts();
        return;
      }
      if ((e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (s.placement) s.cancelPlacement();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedIds.length > 0) {
        e.preventDefault();
        s.deleteSelectedParts();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const saveState = () => {
    switch (saveStatus.state) {
      case 'guest':
        return <span className="save-state hint">游客模式 · 编辑仅存于本页</span>;
      case 'saving':
        return (
          <span className="save-state hint">
            <span className="save-dot saving" />
            保存中…
          </span>
        );
      case 'saved':
        return (
          <span className="save-state hint">
            <span className="save-dot" />
            已保存 · v{saveStatus.version}
          </span>
        );
      case 'conflict':
        return (
          <span className="save-state error">
            冲突：{saveStatus.message}{' '}
            <button type="button" className="link" onClick={() => reloadServerModel()}>
              载入最新版本（本地修改将被覆盖）
            </button>
          </span>
        );
      case 'error':
        return <span className="save-state error">保存失败：{saveStatus.message}</span>;
      default:
        return null;
    }
  };

  const exitPlacement = () => cancelPlacement();

  return (
    <div className="editor-page">
      {/* 浮动文件卡（左上） */}
      <div className="file-card">
        <span className="file-logo">木</span>
        {nameEditing ? (
          <input
            className="design-name-input"
            autoFocus
            value={model.meta.name}
            aria-label="设计名称"
            onBlur={(e) => {
              setNameEditing(false);
              if (e.target.value.trim()) useEditor.getState().rename(e.target.value.trim());
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        ) : (
          <strong className="design-name" onDoubleClick={() => setNameEditing(true)} title="双击重命名">
            {model.meta.name}
          </strong>
        )}
        {saveState()}
      </div>

      {/* 浮动操作组（右上） */}
      <div className="top-actions">
        <button type="button" className="icon-btn" onClick={() => undo()} disabled={!editor?.canUndo()} title="撤销" aria-label="撤销">
          <IconUndo size={15} />
        </button>
        <button type="button" className="icon-btn" onClick={() => redo()} disabled={!editor?.canRedo()} title="重做" aria-label="重做">
          <IconRedo size={15} />
        </button>
        <span className="v-div" />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setModal('versions')}
          title="版本历史"
          aria-label="版本历史"
          data-testid="open-versions"
        >
          <IconHistory size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setHelpOpen(true)}
          title="使用说明（含 Edge 鼠标手势 Q&A）"
          aria-label="使用说明"
          data-testid="open-help"
        >
          <IconHelp size={15} />
        </button>
        {user ? (
          <div className="user-menu-wrap">
            <button
              type="button"
              className="avatar-btn"
              title={user.nickname}
              aria-label={`用户菜单：${user.nickname}`}
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((v) => !v)}
            >
              {user.nickname.slice(0, 1)}
            </button>
            {userMenuOpen && (
              <div className="user-menu" role="menu">
                <div className="user-menu-name">{user.nickname}</div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/designs');
                  }}
                >
                  <IconFolder size={14} />
                  我的设计
                </button>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setUserMenuOpen(false);
                      navigate('/admin/catalog');
                    }}
                  >
                    <IconShield size={14} />
                    管理后台
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void logout();
                  }}
                >
                  <IconLogOut size={14} />
                  登出
                </button>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="btn-login" onClick={() => navigate(`/login?next=${id ? `/editor/${id}` : '/editor'}`)}>
            登录保存
          </button>
        )}
      </div>

      {/* 防误触离开确认（Edge 鼠标手势返回等触发） */}
      {leaveWarning && (
        <div className="banners">
          <div className="banner conflict">
            <span>存在未保存的编辑，返回将丢失（可能由浏览器鼠标手势误触发）。</span>
            <button type="button" onClick={() => setLeaveWarning(false)}>
              留在此页
            </button>
            <button type="button" onClick={discardAndLeave}>
              放弃并离开
            </button>
          </div>
        </div>
      )}

      {/* 状态横幅（顶部居中浮动） */}
      {(saveStatus.state === 'conflict' || lastOpMessage || loadError) && (
        <div className="banners">
          {saveStatus.state === 'conflict' && (
            <div className="banner conflict">
              <span>该设计在其他标签页被更新：{saveStatus.message}</span>
              <button type="button" onClick={() => void reloadServerModel()}>
                载入最新版本
              </button>
              <button type="button" onClick={() => useEditor.getState().resetConflict()}>
                保留我的编辑
              </button>
            </div>
          )}
          {lastOpMessage && <div className="banner warn">{lastOpMessage}</div>}
          {loadError && <div className="banner error">{loadError}</div>}
        </div>
      )}

      {!loaded && !loadError && <p className="loading">加载中…</p>}

      {loaded && (
        <div className="editor-body">
          <PartsPanel />
          <div className="viewer-wrap">
            <Viewer3D
              ref={viewerRef}
              model={model}
              catalog={catalog}
              selectedIds={selectedIds}
              onSelect={(pid, additive) => select(pid, additive)}
              onMove={(pid, position) => {
                const profile = model.profiles.find((p) => p.id === pid);
                if (profile) moveProfile(pid, position);
                else movePanel(pid, position);
              }}
              onMoveMany={(updates) => moveParts(updates)}
              onContextMenu={(pos) => setCtxMenu(pos)}
              onGestureStart={() => beginGesture()}
              onGestureEnd={() => endGesture()}
              onResize={(pid, cutLength, position) => setProfileExtent(pid, cutLength, position)}
              placement={placement}
              onPlaceProfile={({ specCode, orientation, cutLength, position }) => {
                addProfile({ specCode, cutLength, position, orientation });
              }}
              onCancelPlacement={() => cancelPlacement()}
            />

            {/* 放置胶囊：面板收起时是唯一的放置控制入口 */}
            {placement && (
              <div className="placement-pill" data-testid="placement-bar">
                <span className="pill-label">
                  放置 <b>{placement.specCode}</b>
                </span>
                <div className="pill-seg" role="group" aria-label="放置朝向">
                  {ORIENTATIONS.map((o) => (
                    <button
                      type="button"
                      key={o.value}
                      aria-pressed={placement.orientation === o.value}
                      onClick={() => setPlacementOrientation(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="pill-exit" title="退出放置（Esc）" onClick={exitPlacement}>
                  退出
                  {showShortcuts && <span className="key-badge inline">Esc</span>}
                </button>
              </div>
            )}

            <EditorToolbar
              placing={Boolean(placement)}
              showShortcuts={showShortcuts}
              onExitPlacement={exitPlacement}
              onOpenLibrary={() => openPanel('spec')}
              onFitView={() => viewerRef.current?.resetView()}
              onOpenBom={() => setModal('bom')}
              onOpenAi={() => setModal('ai')}
            />
          </div>
          <PropertiesPanel />
        </div>
      )}

      {modal === 'bom' && <BomModal onClose={() => setModal(null)} />}
      {modal === 'versions' && <VersionsDrawer onClose={() => setModal(null)} />}
      {modal === 'ai' && <AiPanel onClose={() => setModal(null)} onOpenDiff={() => setModal(null)} />}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { section: '对齐 X（多选）' },
            { label: '最小边对齐', onClick: () => alignSelected('x', 'min') },
            { label: '中心对齐', onClick: () => alignSelected('x', 'center') },
            { label: '最大边对齐', onClick: () => alignSelected('x', 'max') },
            { section: '对齐 Y（多选）' },
            { label: '底部对齐（落地）', onClick: () => alignSelected('y', 'min') },
            { label: '中心对齐', onClick: () => alignSelected('y', 'center') },
            { label: '顶部对齐', onClick: () => alignSelected('y', 'max') },
            { section: '对齐 Z（多选）' },
            { label: '最小边对齐', onClick: () => alignSelected('z', 'min') },
            { label: '中心对齐', onClick: () => alignSelected('z', 'center') },
            { label: '最大边对齐', onClick: () => alignSelected('z', 'max') },
            { label: '删除选中部件', key: 'Del', danger: true, onClick: () => deleteSelectedParts() },
          ]}
        />
      )}

      {designId === null && user === null && !id && (
        <div className="banner guest" data-testid="guest-banner">
          <span>游客模式：编辑仅存在于本页内存。</span>
          <button type="button" onClick={() => navigate('/login?next=/designs')}>
            登录后可保存与导出
          </button>
        </div>
      )}
    </div>
  );
}
