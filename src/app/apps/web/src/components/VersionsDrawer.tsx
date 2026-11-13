import { useEffect, useState } from 'react';
import { useEditor } from '../stores/editor';
import { api, type DesignVersionDto } from '../api';

/** 版本历史抽屉（spec-02：版本列表 + 一键回退，前向追加）。 */
export function VersionsDrawer({ onClose }: { onClose: () => void }) {
  const { designId, reloadServerModel } = useEditor();
  const [versions, setVersions] = useState<DesignVersionDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!designId) return;
    api<DesignVersionDto[]>(`/designs/${designId}/versions`)
      .then(setVersions)
      .catch((e) => setMessage(String(e)));
  }, [designId]);

  if (!designId) {
    return (
      <div className="modal-mask" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <p>游客模式没有云端版本历史。登录并保存后自动记录每次生效变更。</p>
          <button onClick={onClose}>知道了</button>
        </div>
      </div>
    );
  }

  const restore = async (seq: number) => {
    if (!designId) return;
    const current = useEditor.getState().saveStatus;
    const baseVersion = current.state === 'saved' ? current.version : 1;
    try {
      await api(`/designs/${designId}/versions/${seq}/restore`, {
        method: 'POST',
        body: { baseVersion },
      });
      await reloadServerModel();
      setMessage(`已回退到版本 ${seq}`);
      const list = await api<DesignVersionDto[]>(`/designs/${designId}/versions`);
      setVersions(list);
    } catch (err) {
      setMessage(`回退失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="versions-drawer">
        <div className="modal-head">
          <h2>版本历史</h2>
          <button onClick={onClose}>关闭</button>
        </div>
        {message && <p className="hint">{message}</p>}
        {!versions && <p>加载中…</p>}
        {versions && versions.length === 0 && <p className="muted">暂无版本（保存后自动生成）</p>}
        {versions && (
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>摘要</th>
                <th>时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.seq}>
                  <td>#{v.seq}</td>
                  <td>{v.summary}</td>
                  <td>{new Date(v.createdAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => restore(v.seq)}>回退到此版本</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
