import { useEffect, useState } from 'react';
import { useEditor } from '../stores/editor';
import { useAuth } from '../stores/auth';
import { api, exportBomPdf } from '../api';
import { generateBom } from '@modatu/bom';
import type { Bom } from '@modatu/bom';

/** BOM 预览弹窗（spec-05：导出前预览；游客本地计算，登录用户可导出 PDF）。 */
export function BomModal({ onClose }: { onClose: () => void }) {
  const { model, catalog, designId, model: _m } = useEditor();
  const user = useAuth((s) => s.user);
  const [bom, setBom] = useState<Bom | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (designId) {
      api<{ bom: Bom }>(`/designs/${designId}/bom`, { method: 'POST', body: {} })
        .then((r) => setBom(r.bom))
        .catch(() => setBom(generateBom(model, catalog)));
    } else {
      setBom(generateBom(model, catalog));
    }
  }, [designId, model, catalog]);

  const doExport = async () => {
    if (!designId) {
      setExportMsg('请先登录并保存设计后再导出');
      return;
    }
    setExporting(true);
    try {
      const blob = await exportBomPdf(designId, model);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modatu-bom.pdf';
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg('已导出 PDF');
    } catch (err) {
      setExportMsg(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="bom-modal">
        <div className="modal-head">
          <h2>配置清单（BOM）</h2>
          <button onClick={onClose}>关闭</button>
        </div>
        {!bom && <p>计算中…</p>}
        {bom && (
          <div className="bom-body">
            <h3>型材（切割规格）</h3>
            <table data-testid="bom-profiles">
              <thead>
                <tr>
                  <th>规格</th>
                  <th>切割长度 (mm)</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {bom.profiles.map((r) => (
                  <tr key={`${r.specCode}-${r.cutLength}`}>
                    <td>{r.specCode}</td>
                    <td>{r.cutLength}</td>
                    <td>{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>连接件</h3>
            {bom.connectors.length === 0 && <p className="muted">无</p>}
            <table>
              <tbody>
                {bom.connectors.map((r) => (
                  <tr key={r.connectorId}>
                    <td>{r.name}</td>
                    <td>{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {bom.unresolvedConnectors.length > 0 && (
              <div className="warning-list" data-testid="bom-warnings">
                {bom.unresolvedConnectors.map((u) => (
                  <p key={u.connectorId}>
                    ⚠ 无法自动计算：{u.connectorName ?? u.connectorId}（{u.joints.length} 个连接点），请回编辑器修正
                  </p>
                ))}
              </div>
            )}

            <h3>板材（裁切规格）</h3>
            {bom.panels.length === 0 && <p className="muted">无</p>}
            <table>
              <thead>
                <tr>
                  <th>材质</th>
                  <th>厚度 (mm)</th>
                  <th>宽 (mm)</th>
                  <th>高 (mm)</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {bom.panels.map((r) => (
                  <tr key={`${r.materialId}-${r.thickness}-${r.width}-${r.height}`}>
                    <td>{r.materialName}</td>
                    <td>{r.thickness}</td>
                    <td>{r.width}</td>
                    <td>{r.height}</td>
                    <td>{r.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="modal-foot">
              <span className="muted">单位 mm · 与设计数值一致</span>
              <button onClick={doExport} disabled={exporting || !user} data-testid="export-pdf">
                {exporting ? '导出中…' : '导出带水印 PDF'}
              </button>
              {!user && <span className="hint">导出需登录（水印需要身份）</span>}
              {exportMsg && <span className="hint">{exportMsg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
