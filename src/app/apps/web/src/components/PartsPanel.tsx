import { useMemo, useState } from 'react';
import { useEditor, type PanelSection } from '../stores/editor';
import { buildParametricCrossSection, loopsToSvgPath, profilePricePerMeter, type ProfileSpec } from '@modatu/catalog';
import {
  IconBox,
  IconChevronsLeft,
  IconLayers,
  IconMousePointer,
  IconPlus,
  IconSearch,
} from './icons';

/** 截面 SVG 预览（精确 DXF 环，无截面数据时参数化近似），grid view 卡片用。 */
function SectionThumb({ spec }: { spec: ProfileSpec }) {
  const d = useMemo(() => {
    const loops =
      spec.crossSection && spec.crossSection.loops.length > 0
        ? spec.crossSection.loops
        : buildParametricCrossSection({ width: spec.width, height: spec.height, slotWidth: spec.slotWidth }).loops;
    return loopsToSvgPath(loops, true);
  }, [spec]);
  const pad = Math.max(spec.width, spec.height) * 0.08;
  return (
    <svg
      className="spec-thumb"
      viewBox={`${-spec.width / 2 - pad} ${-spec.height / 2 - pad} ${spec.width + pad * 2} ${spec.height + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${spec.code} 截面`}
    >
      <path d={d} fillRule="evenodd" fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 放置朝向选项（放置条 / 放置胶囊共用） */
export const ORIENTATIONS = [
  { value: 'y' as const, label: '立柱 Y' },
  { value: 'x' as const, label: '沿 X' },
  { value: 'z' as const, label: '沿 Z' },
];

/** 规格系列分组：2020/2040 → 20 系列，3030/3060 → 30 系列，4040 → 40 系列。 */
function seriesGroupOf(code: string): string {
  return `${code.slice(0, 2)} 系列`;
}

const SECTION_TITLES: Record<PanelSection, string> = {
  spec: '型材库',
  parts: '部件',
  insert: '插入',
};

/**
 * 左侧工具轨 + 浮动面板（Figma UI3 式，spec 见 docs/terminology.md）：
 * - 工具轨默认折叠（仅 icon + padding 宽度），画布占满剩余宽度；
 * - 顶部「选择」工具：退出放置模式，恢复画布点选/拖拽调整；
 * - 型材库/部件/插入三个图标展开浮动面板（悬浮于画布之上，不挤压画布）。
 */
export function PartsPanel() {
  const {
    model,
    catalog,
    selectedId,
    select,
    addPanel,
    placement,
    startPlacement,
    setPlacementOrientation,
    cancelPlacement,
    panelOpen,
    panelSection,
    openPanel,
    closePanel,
    showShortcuts,
  } = useEditor();
  const [shelfPos, setShelfPos] = useState(600);

  const toggleSection = (s: PanelSection) => {
    if (panelOpen && panelSection === s) closePanel();
    else openPanel(s);
  };

  return (
    <div className="rail-area">
      <nav className="rail" data-testid="parts-panel" aria-label="工具轨">
        <button
          type="button"
          className={`rail-btn${!placement ? ' active' : ''}`}
          title="选择（V）"
          aria-label="选择工具（V）"
          aria-pressed={!placement}
          onClick={() => cancelPlacement()}
        >
          <IconMousePointer size={17} />
          {showShortcuts && <span className="key-badge">V</span>}
        </button>
        <span className="rail-div" />
        <button
          type="button"
          className={`rail-btn${panelOpen && panelSection === 'spec' ? ' active' : ''}`}
          title="型材库"
          aria-label="型材库"
          aria-pressed={panelOpen && panelSection === 'spec'}
          onClick={() => toggleSection('spec')}
        >
          <IconBox size={17} />
        </button>
        <button
          type="button"
          className={`rail-btn${panelOpen && panelSection === 'parts' ? ' active' : ''}`}
          title="部件"
          aria-label="部件"
          aria-pressed={panelOpen && panelSection === 'parts'}
          onClick={() => toggleSection('parts')}
        >
          <IconLayers size={17} />
        </button>
        <button
          type="button"
          className={`rail-btn${panelOpen && panelSection === 'insert' ? ' active' : ''}`}
          title="插入封板"
          aria-label="插入封板"
          aria-pressed={panelOpen && panelSection === 'insert'}
          onClick={() => toggleSection('insert')}
        >
          <IconPlus size={17} />
        </button>
      </nav>

      {panelOpen && (
        <aside className="parts-float" data-testid="parts-float">
          <div className="parts-float-head">
            <strong>{SECTION_TITLES[panelSection]}</strong>
            <button type="button" className="icon-btn" title="收起面板" aria-label="收起面板" onClick={closePanel}>
              <IconChevronsLeft size={15} />
            </button>
          </div>
          <div className="parts-float-body">
            {panelSection === 'spec' && <SpecLibrary />}
            {panelSection === 'parts' && <PartsList />}
            {panelSection === 'insert' && (
              <div className="form">
                <label>
                  封板离地高度 (mm)
                  <input type="number" step={10} value={shelfPos} onChange={(e) => setShelfPos(Number(e.target.value))} />
                </label>
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="add-panel"
                  onClick={() =>
                    addPanel({
                      materialId: catalog.panelMaterials[0]?.id ?? '',
                      thickness: catalog.panelMaterials[0]?.thicknesses.at(-1) ?? 15,
                      width: 800,
                      height: 400,
                      position: { x: 0, y: shelfPos, z: 0 },
                      plane: 'xz',
                    })
                  }
                >
                  + 层板/封板（顶面）
                </button>
              </div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

/** 型材库分区：搜索 → 系列分类 → 规格网格 → 放置状态条。 */
function SpecLibrary() {
  const { catalog, placement, startPlacement, cancelPlacement, setPlacementOrientation } = useEditor();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const s of catalog.profiles) set.add(seriesGroupOf(s.code));
    return ['all', ...set];
  }, [catalog.profiles]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.profiles.filter((s) => {
      if (q) {
        const hay = `${s.code} ${s.width}×${s.height} ${s.series}`.toLowerCase();
        return hay.includes(q);
      }
      if (category !== 'all' && seriesGroupOf(s.code) !== category) return false;
      return true;
    });
  }, [catalog.profiles, query, category]);

  const enabledCount = visible.filter((s) => s.enabled).length;

  const togglePlacement = (code: string) => {
    if (placement?.specCode === code) cancelPlacement();
    else startPlacement(code, placement?.orientation ?? 'y');
  };

  return (
    <>
      <div className="panel-meta">
        <span>{query ? `搜索到 ${enabledCount} 个` : `${enabledCount} 个可用`}</span>
      </div>
      <div className="spec-search">
        <IconSearch size={14} />
        <input
          type="text"
          placeholder="搜索规格 / 尺寸 / 系列"
          aria-label="搜索型材规格"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="spec-chips" role="group" aria-label="按系列分类">
        {groups.map((g) => {
          const n = g === 'all' ? catalog.profiles.filter((s) => s.enabled).length : catalog.profiles.filter((s) => s.enabled && seriesGroupOf(s.code) === g).length;
          const active = !query && category === g;
          return (
            <button
              type="button"
              key={g}
              className={`spec-chip${active ? ' active' : ''}`}
              aria-pressed={active}
              onClick={() => {
                setCategory(g);
                setQuery('');
              }}
            >
              {g === 'all' ? '全部' : g}
              <span className="spec-chip-n">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="spec-grid" data-testid="spec-grid">
        {visible.map((s) => {
          const price = profilePricePerMeter(s, 'finish-natural');
          const off = !s.enabled;
          return (
            <button
              type="button"
              key={s.code}
              data-testid={`spec-card-${s.code}`}
              className={`spec-card${placement?.specCode === s.code ? ' active' : ''}${off ? ' disabled' : ''}`}
              disabled={off}
              onClick={() => togglePlacement(s.code)}
              title={`${s.series} · 槽宽 ${s.slotWidth}mm${price !== null ? ` · ¥${price}/米` : ''}${off ? ' · 已停用' : ''}`}
            >
              <span className="spec-thumb-box">
                <SectionThumb spec={s} />
                {off && <span className="spec-offtag">已停用</span>}
              </span>
              <strong>{s.code}</strong>
              <span className="hint">
                {s.width}×{s.height} · {s.slotWidth}槽
              </span>
              <span className="hint">
                {s.massPerMeter}kg/m{price !== null ? ` · ¥${price}/米` : ''}
              </span>
            </button>
          );
        })}
        {visible.length === 0 && <p className="muted">没有匹配的规格</p>}
      </div>

      {placement && (
        <div className="placement-bar">
          <p className="hint">
            正在放置 <strong>{placement.specCode}</strong>：画布内鼠标跟随 ghost，按住拖拽定长松手创建。
            默认 10mm 步进，按住 Shift 丝滑 1mm。Esc 退出。
          </p>
          <div className="row">
            {ORIENTATIONS.map((o) => (
              <button
                type="button"
                key={o.value}
                className={placement.orientation === o.value ? 'primary' : ''}
                aria-pressed={placement.orientation === o.value}
                onClick={() => setPlacementOrientation(o.value)}
              >
                {o.label}
              </button>
            ))}
            <button type="button" onClick={cancelPlacement}>
              退出放置
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** 部件分区：型材/封板层级列表 + 选中型材的连接表单。 */
function PartsList() {
  const { model, catalog, selectedId, select, addConnection } = useEditor();
  const [showConnect, setShowConnect] = useState(false);
  const selectedProfile = model.profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <>
      <p className="panel-meta">型材（{model.profiles.length}）</p>
      <ul className="part-list">
        {model.profiles.map((p) => (
          <li
            key={p.id}
            className={p.id === selectedId ? 'selected' : ''}
            onClick={() => select(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') select(p.id);
            }}
          >
            <span className="part-meta">型材 {p.specCode}</span>
            <span className="hint">{p.cutLength}mm</span>
          </li>
        ))}
        {model.profiles.length === 0 && <li className="muted">尚无型材，去「型材库」放置</li>}
      </ul>

      <p className="panel-meta">封板（{model.panels.length}）</p>
      <ul className="part-list">
        {model.panels.map((p) => (
          <li
            key={p.id}
            className={p.id === selectedId ? 'selected' : ''}
            onClick={() => select(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') select(p.id);
            }}
          >
            <span className="part-meta">封板 {p.materialId}</span>
            <span className="hint">
              {p.width}×{p.height}×{p.thickness}
            </span>
          </li>
        ))}
        {model.panels.length === 0 && <li className="muted">尚无封板，去「插入」添加</li>}
      </ul>

      {selectedProfile && (
        <div className="connect-block">
          <p className="panel-meta">连接（{selectedProfile.connections.length}）</p>
          <p className="hint">当前型材已有 {selectedProfile.connections.length} 条连接</p>
          <button type="button" onClick={() => setShowConnect((v) => !v)}>
            {showConnect ? '− 收起' : '+ 添加连接'}
          </button>
          {showConnect && selectedId && (
            <ConnectForm
              sourceId={selectedId}
              sourceSpec={selectedProfile.specCode}
              onAdd={(targetId, connectorId) => addConnection(selectedId, connectorId, targetId)}
            />
          )}
        </div>
      )}
    </>
  );
}

/** 为选中型材添加连接（仅列出与两侧规格兼容的连接件）。 */
function ConnectForm(props: {
  sourceId: string;
  sourceSpec: string;
  onAdd: (targetId: string, connectorId: string) => void;
}) {
  const { model, catalog } = useEditor();
  const targets = model.profiles.filter((p) => p.id !== props.sourceId);
  const [targetId, setTargetId] = useState('');
  const target = targets.find((t) => t.id === targetId);

  const connectors = target
    ? catalog.compatibilities
        .filter(
          (c) =>
            ((c.profileCodeA === props.sourceSpec && c.profileCodeB === target.specCode) ||
              (c.profileCodeA === target.specCode && c.profileCodeB === props.sourceSpec)) &&
            catalog.connectors.some((cn) => cn.id === c.connectorId),
        )
        .map((c) => ({
          id: c.connectorId,
          name: catalog.connectors.find((cn) => cn.id === c.connectorId)?.name ?? c.connectorId,
        }))
    : [];

  const [connectorId, setConnectorId] = useState('');

  if (targets.length === 0) return <p className="muted">没有可连接的其他型材</p>;

  return (
    <div className="subform">
      <label>
        连接到
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">选择目标型材…</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.specCode} @ {t.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        连接件
        <select value={connectorId} onChange={(e) => setConnectorId(e.target.value)}>
          <option value="">选择连接件…</option>
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {target && connectors.length === 0 && (
        <p className="hint">
          规格 {props.sourceSpec} × {target.specCode} 之间暂无兼容连接件
        </p>
      )}
      <button type="button" className="btn-primary" disabled={!targetId || !connectorId} onClick={() => props.onAdd(targetId, connectorId)}>
        添加连接
      </button>
    </div>
  );
}
