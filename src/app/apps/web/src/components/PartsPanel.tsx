import { useState } from 'react';
import { useEditor } from '../stores/editor';

/** 左侧部件列表 + 添加受约束部件（立柱/横梁/封板）与连接。 */
export function PartsPanel() {
  const { model, catalog, selectedId, select, addProfile, addPanel, addConnection } = useEditor();
  const [specCode, setSpecCode] = useState(catalog.profiles[0]?.code ?? '');
  const [shelfPos, setShelfPos] = useState(600);
  const [showConnect, setShowConnect] = useState(false);

  const selectedProfile = model.profiles.find((p) => p.id === selectedId) ?? null;

  return (
    <aside className="parts" data-testid="parts-panel">
      <h3>添加部件</h3>
      <div className="form">
        <label>
          规格
          <select value={specCode} onChange={(e) => setSpecCode(e.target.value)}>
            {catalog.profiles.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}（{s.width}×{s.height}）
              </option>
            ))}
          </select>
        </label>
        <button data-testid="add-column" onClick={() => addProfile({ specCode, cutLength: 1500, position: { x: 0, y: 0, z: 0 }, orientation: 'y' })}>
          + 立柱（竖向型材）
        </button>
        <button onClick={() => addProfile({ specCode, cutLength: 800, position: { x: 0, y: 500, z: 0 }, orientation: 'x' })}>
          + 横梁（水平型材）
        </button>
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
