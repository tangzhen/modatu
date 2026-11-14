import { useMemo, useState } from 'react';
import { useEditor } from '../stores/editor';
import { buildParametricCrossSection, loopsToSvgPath, profilePricePerMeter, type ProfileSpec } from '@modatu/catalog';

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
      <path d={d} fillRule="evenodd" fill="currentColor" stroke="currentColor" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const ORIENTATIONS = [
  { value: 'y' as const, label: '立柱 Y' },
  { value: 'x' as const, label: '沿 X' },
  { value: 'z' as const, label: '沿 Z' },
];

/** 左侧部件列表：规格 Grid View 选择 + 3D ghost 放置创建 + 封板/连接。 */
export function PartsPanel() {
  const {
    model,
    catalog,
    selectedId,
    select,
    addPanel,
    addConnection,
    placement,
    startPlacement,
    setPlacementOrientation,
    cancelPlacement,
  } = useEditor();
  const [shelfPos, setShelfPos] = useState(600);
  const [showConnect, setShowConnect] = useState(false);

  const selectedProfile = model.profiles.find((p) => p.id === selectedId) ?? null;

  const togglePlacement = (code: string) => {
    if (placement?.specCode === code) cancelPlacement();
    else startPlacement(code, placement?.orientation ?? 'y');
  };

  return (
    <aside className="parts" data-testid="parts-panel">
      <h3>选择规格（点击进入放置）</h3>
      <div className="spec-grid" data-testid="spec-grid">
        {catalog.profiles.map((s) => {
          const price = profilePricePerMeter(s, 'finish-natural');
          return (
            <button
              key={s.code}
              data-testid={`spec-card-${s.code}`}
              className={`spec-card${placement?.specCode === s.code ? ' active' : ''}`}
              onClick={() => togglePlacement(s.code)}
              title={`${s.series} · 槽宽 ${s.slotWidth}mm${price !== null ? ` · ¥${price}/米` : ''}`}
            >
              <SectionThumb spec={s} />
              <strong>{s.code}</strong>
              <span className="hint">
                {s.width}×{s.height} · {s.massPerMeter}kg/m
                {price !== null ? ` · ¥${price}/米` : ''}
              </span>
            </button>
          );
        })}
      </div>

      {placement && (
        <div className="form placement-bar" data-testid="placement-bar">
          <p className="hint">
            放置 <strong>{placement.specCode}</strong>：3D 视图内鼠标跟随 ghost，按住拖拽定长松手创建。
            默认 10mm 步进，按住 Shift 丝滑 1mm。Esc 退出。
          </p>
          <div className="row">
            {ORIENTATIONS.map((o) => (
              <button
                key={o.value}
                className={placement.orientation === o.value ? 'primary' : ''}
                onClick={() => setPlacementOrientation(o.value)}
              >
                {o.label}
              </button>
            ))}
            <button onClick={cancelPlacement}>退出放置</button>
          </div>
        </div>
      )}

      <h3>封板</h3>
      <div className="form">
        <label>
          封板离地高度 (mm)
          <input type="number" step={10} value={shelfPos} onChange={(e) => setShelfPos(Number(e.target.value))} />
        </label>
        <button
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

      <h3>型材（{model.profiles.length}）</h3>
      <ul className="part-list">
        {model.profiles.map((p) => (
          <li key={p.id} className={p.id === selectedId ? 'selected' : ''} onClick={() => select(p.id)}>
            型材 {p.specCode} · {p.cutLength}mm
          </li>
        ))}
      </ul>

      <h3>封板（{model.panels.length}）</h3>
      <ul className="part-list">
        {model.panels.map((p) => (
          <li key={p.id} className={p.id === selectedId ? 'selected' : ''} onClick={() => select(p.id)}>
            封板 {p.materialId} · {p.width}×{p.height}×{p.thickness}
          </li>
        ))}
      </ul>

      {selectedProfile && (
        <div className="form">
          <h3>连接</h3>
          <p className="hint">当前型材已有 {selectedProfile.connections.length} 条连接</p>
          <button onClick={() => setShowConnect((v) => !v)}>
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
    </aside>
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
        <p className="hint">规格 {props.sourceSpec} × {target.specCode} 之间暂无兼容连接件</p>
      )}
      <button disabled={!targetId || !connectorId} onClick={() => props.onAdd(targetId, connectorId)}>
        添加连接
      </button>
    </div>
  );
}
