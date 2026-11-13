import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { useEditor } from '../stores/editor';
import { Viewer3D } from '../components/Viewer3D';
import { PartsPanel } from '../components/PartsPanel';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { BomModal } from '../components/BomModal';
import { VersionsDrawer } from '../components/VersionsDrawer';
import { AiPanel } from '../components/AiPanel';

/** 编辑器主界面（spec-04）：3D 预览 + 受约束编辑 + 自动保存 + 版本/BOM/AI。 */
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
    selectedId,
    moveProfile,
    movePanel,
    undo,
    redo,
    editor,
    saveStatus,
    lastOpMessage,
    reloadServerModel,
  } = useEditor();

  const [modal, setModal] = useState<'bom' | 'versions' | 'ai' | null>(null);
  const [nameEditing, setNameEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const saveState = () => {
    switch (saveStatus.state) {
      case 'guest':
        return <span className="hint">游客模式 · 编辑仅存于本页，保存需登录</span>;
      case 'saving':
        return <span className="hint">保存中…</span>;
      case 'saved':
        return <span className="hint">已保存 · 版本 #{saveStatus.version}</span>;
      case 'conflict':
        return (
          <span className="error">
            冲突：{saveStatus.message}{' '}
            <button
              onClick={() =>
                reloadServerModel()
              }
            >
              载入最新版本（本地修改将被覆盖）
            </button>
          </span>
        );
      case 'error':
        return <span className="error">保存失败：{saveStatus.message}</span>;
      default:
        return null;
    }
  };

  return (
    <div className="editor-page">
      <header className="editor-top">
        <span className="brand">木搭图</span>
        {nameEditing ? (
          <input
            autoFocus
            value={model.meta.name}
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
        <span className="spacer" />
        <button onClick={() => editor?.undo()} disabled={!editor?.canUndo()} title="撤销">
          ↩ 撤销
        </button>
        <button onClick={() => editor?.redo()} disabled={!editor?.canRedo()} title="重做">
          ↪ 重做
        </button>
        <button onClick={() => setModal('versions')} data-testid="open-versions">
          版本历史
        </button>
        <button onClick={() => setModal('bom')} data-testid="open-bom">
          清单（BOM）
        </button>
        <button onClick={() => setModal('ai')} data-testid="open-ai">
          AI 生成/修改
        </button>
        {user ? (
          <>
            <span className="hint">{user.nickname}</span>
            {user.role === 'admin' && <button onClick={() => navigate('/admin/catalog')}>后台</button>}
            <button onClick={() => navigate('/designs')}>我的设计</button>
            <button onClick={() => void logout()}>登出</button>
          </>
        ) : (
          <button onClick={() => navigate(`/login?next=${id ? `/editor/${id}` : '/editor'}`)}>
            登录保存
          </button>
        )}
      </header>

      {saveStatus.state === 'conflict' && (
        <div className="banner conflict">
          <span>该设计在其他标签页被更新：{saveStatus.message}</span>
          <button onClick={() => void reloadServerModel()}>载入最新版本</button>
          <button onClick={() => useEditor.getState().resetConflict()}>保留我的编辑（之后手动合并）</button>
        </div>
      )}

      {lastOpMessage && <div className="banner warn">{lastOpMessage}</div>}
      {loadError && <div className="banner error">{loadError}</div>}

      {!loaded && !loadError && <p className="loading">加载中…</p>}

      {loaded && (
        <div className="editor-body">
          <PartsPanel />
          <div className="viewer-wrap">
            <Viewer3D
              model={model}
              catalog={catalog}
              selectedId={selectedId}
              onSelect={(pid) => select(pid)}
              onDrag={(pid, x, z) => {
                const profile = model.profiles.find((p) => p.id === pid);
                const panel = model.panels.find((p) => p.id === pid);
                if (profile) moveProfile(pid, { x, y: profile.position.y, z });
                else if (panel) movePanel(pid, { x, y: panel.position.y, z });
              }}
            />
            <p className="hint viewer-hint">拖动旋转视角 · 滚轮缩放 · 点击选择部件 · 按住拖动沿地面移动（10mm 吸附）</p>
          </div>
          <PropertiesPanel />
        </div>
      )}

      {modal === 'bom' && <BomModal onClose={() => setModal(null)} />}
      {modal === 'versions' && <VersionsDrawer onClose={() => setModal(null)} />}
      {modal === 'ai' && (
        <AiPanel onClose={() => setModal(null)} onOpenDiff={() => setModal(null)} />
      )}
      {designId === null && user === null && !id && (
        <div className="banner guest" data-testid="guest-banner">
          游客模式：编辑仅存在于本页内存。{' '}
          <button onClick={() => navigate('/login?next=/designs')}>登录后可保存与导出</button>
        </div>
      )}
    </div>
  );
}
