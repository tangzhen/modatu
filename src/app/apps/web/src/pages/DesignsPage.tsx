import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type DesignSummary } from '../api';
import { useAuth } from '../stores/auth';

/** 我的设计列表（spec-02）：查看/打开/重命名/删除（软删除）。 */
export function DesignsPage() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!user) {
      navigate('/login?next=/designs');
      return;
    }
    api<DesignSummary[]>('/designs')
      .then(setDesigns)
      .catch((e) => setMessage(String(e)));
  }, [user, navigate]);

  const create = async () => {
    try {
      const created = await api<{ id: string }>('/designs', {
        method: 'POST',
        body: { name: newName || '未命名设计' },
      });
      navigate(`/editor/${created.id}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const rename = async (id: string, name: string) => {
    await api(`/designs/${id}`, { method: 'PATCH', body: { name } });
    setDesigns((prev) => prev?.map((d) => (d.id === id ? { ...d, name } : d)) ?? null);
  };

  const remove = async (id: string) => {
    await api(`/designs/${id}`, { method: 'DELETE' });
    setDesigns((prev) => prev?.filter((d) => d.id !== id) ?? null);
  };

  return (
    <div className="page" data-testid="designs-page">
      <h1>我的设计</h1>
      <div className="row">
        <input
          placeholder="新项目名称"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          data-testid="new-design-name"
        />
        <button onClick={create} data-testid="create-design">
          新建设计
        </button>
        <button onClick={() => navigate('/editor')}>
          游客模式试用（不保存）
        </button>
      </div>
      {message && <p className="error">{message}</p>}
      {!designs && <p>加载中…</p>}
      {designs && designs.length === 0 && <p className="muted">还没有设计，创建一个或用 AI 生成。</p>}
      {designs && (
        <table data-testid="design-list">
          <thead>
            <tr>
              <th>名称</th>
              <th>版本</th>
              <th>最近更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {designs.map((d) => (
              <tr key={d.id}>
                <td>
                  <Link to={`/editor/${d.id}`}>{d.name}</Link>
                </td>
                <td>#{d.version}</td>
                <td>{new Date(d.updatedAt).toLocaleString()}</td>
                <td>
                  <button
                    onClick={() => {
                      const name = window.prompt('新名称', d.name);
                      if (name) void rename(d.id, name);
                    }}
                  >
                    重命名
                  </button>
                  <button className="danger" onClick={() => void remove(d.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
