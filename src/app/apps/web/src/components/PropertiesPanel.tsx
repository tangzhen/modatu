import { useMemo } from 'react';
import { useEditor } from '../stores/editor';
import { evaluateSafetyRules } from '@modatu/safety-rules';

/** 右侧属性面板：选中部件的受约束表单编辑 + 规则化安全提示（spec-04）。 */
export function PropertiesPanel() {
  const { model, catalog, selectedId, resizeProfile, changeSpec, resizePanel, setPanelMaterial, removeProfile, removePanel, removeConnection } =
    useEditor();

  const selectedProfile = model.profiles.find((p) => p.id === selectedId) ?? null;
  const selectedPanel = model.panels.find((p) => p.id === selectedId) ?? null;
  const spec = selectedProfile
    ? catalog.profiles.find((s) => s.code === selectedProfile.specCode)
    : undefined;

  const hints = useMemo(() => evaluateSafetyRules(model, catalog), [model, catalog]);

  return (
    <aside className="properties" data-testid="properties-panel">
      <h3>属性</h3>
      {!selectedProfile && !selectedPanel && <p className="muted">点击 3D 视图或部件列表选择部件</p>}

      {selectedProfile && (
        <div className="form">
          <label>
            规格
            <select
              value={selectedProfile.specCode}
              onChange={(e) => changeSpec(selectedProfile.id, e.target.value)}
            >
              {catalog.profiles.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}（{s.width}×{s.height}）
                </option>
              ))}
            </select>
          </label>
          {spec && (
            <p className="hint">
              截面 {spec.width}×{spec.height}mm · 槽宽 {spec.slotWidth}mm ·{' '}
              {spec.loadRatings.length > 0
                ? `承重参考 ${spec.loadRatings.map((r) => `${r.span}mm→${r.load}kg`).join('，')}`
                : '无承重数据'}
            </p>
          )}
          <label>
            切割长度 (mm)
            <input
              type="number"
              step={0.5}
              value={selectedProfile.cutLength}
              onChange={(e) => resizeProfile(selectedProfile.id, Number(e.target.value))}
            />
          </label>
          {spec && (
            <p className="hint">
              允许范围 [{spec.minCutLength}, {spec.maxCutLength}] mm
            </p>
          )}

          <h4>连接（{selectedProfile.connections.length}）</h4>
          {selectedProfile.connections.length === 0 && <p className="muted">无连接</p>}
          {selectedProfile.connections.map((c) => {
            const target = model.profiles.find((p) => p.id === c.targetPartId);
            return (
              <div key={`${c.connectorId}-${c.targetPartId}`} className="row">
                <span className="hint">
                  {catalog.connectors.find((cn) => cn.id === c.connectorId)?.name ?? c.connectorId}
                  {' → '}
                  {target ? `${target.specCode}@${target.id}` : c.targetPartId}
                </span>
                <button onClick={() => removeConnection(selectedProfile.id, c.connectorId, c.targetPartId)}>
                  移除
                </button>
              </div>
            );
          })}

          <button className="danger" onClick={() => removeProfile(selectedProfile.id)}>
            删除该型材
          </button>
        </div>
      )}

      {selectedPanel && (
        <div className="form">
          <label>
            材质
            <select
              value={selectedPanel.materialId}
              onChange={(e) => setPanelMaterial(selectedPanel.id, e.target.value)}
            >
              {catalog.panelMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            厚度 (mm)
            <input
              type="number"
              step={0.5}
              value={selectedPanel.thickness}
              onChange={(e) => resizePanel(selectedPanel.id, { thickness: Number(e.target.value) })}
            />
          </label>
          <label>
            宽 (mm)
            <input
              type="number"
              step={0.5}
              value={selectedPanel.width}
              onChange={(e) => resizePanel(selectedPanel.id, { width: Number(e.target.value) })}
            />
          </label>
          <label>
            高 (mm)
            <input
              type="number"
              step={0.5}
              value={selectedPanel.height}
              onChange={(e) => resizePanel(selectedPanel.id, { height: Number(e.target.value) })}
            />
          </label>
          <button className="danger" onClick={() => removePanel(selectedPanel.id)}>
            删除该封板
          </button>
        </div>
      )}

      <h3>安全提示（{hints.length}）</h3>
      {hints.length === 0 && <p className="muted">未发现超出规则阈值的设计</p>}
      <ul className="hints" data-testid="safety-hints">
        {hints.map((h) => (
          <li key={`${h.ruleId}-${h.partId}`}>{h.message}</li>
        ))}
      </ul>
    </aside>
  );
}
