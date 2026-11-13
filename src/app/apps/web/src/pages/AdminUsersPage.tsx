import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../stores/auth';

interface AdminUser {
  id: string;
  username: string | null;
  nickname: string;
  role: string;
  status: string;
  createdAt: string;
}

/** 后台用户管理（spec-03 一期范围：列表、搜索、封禁/解封）。 */
export function AdminUsersPage() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const reload = async (q: string) => {
    const data = await api<AdminUser[]>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    setRows(data);
  };

  useEffect(() => {
    void reload(keyword).catch((e) => setMessage(String(e)));
  }, [keyword]);

  const setStatus = async (id: string, banned: boolean) => {
    await api(`/admin/users/${id}/${banned ? 'ban' : 'unban'}`, { method: 'POST', body: {} });
    await reload(keyword);
  };

  return (
    <div className="page" data-testid="admin-users">
      <h1>后台 · 用户管理</h1>
      <nav className="tabs">
        <Link to="/admin/catalog">知识库维护</Link>
        <Link to="/designs">我的设计</Link>
      </nav>
      {message && <p className="error">{message}</p>}
      <div className="row">
        <input placeholder="搜索用户名/昵称" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>昵称</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="clip">{u.id}</td>
              <td>{u.username ?? '—'}</td>
              <td>{u.nickname}</td>
              <td>{u.role}</td>
              <td>{u.status === 'banned' ? '已封禁' : '正常'}</td>
              <td>{new Date(u.createdAt).toLocaleString()}</td>
              <td>
                {u.status === 'banned' ? (
                  <button onClick={() => void setStatus(u.id, false)}>解封</button>
                ) : (
                  <button className="danger" onClick={() => void setStatus(u.id, true)}>
                    封禁
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
