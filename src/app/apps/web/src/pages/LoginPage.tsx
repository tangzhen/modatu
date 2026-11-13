import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { api } from '../api';

/** 登录页：dev 账密（flag 控制）/隐藏登录页共用表单；微信入口预留"暂未开通"。 */
export function LoginPage({ hidden = false }: { hidden?: boolean }) {
  const { config } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const refreshUser = useAuth((s) => s.refreshUser);

  const devDisabled = !hidden && config !== null && !config.devPasswordLogin;
  const next = params.get('next') ?? '/designs';

  useEffect(() => {
    if (devDisabled) setMessage('开发环境登录已关闭（生产环境请使用隐藏登录页或微信扫码）');
  }, [devDisabled]);

  const submit = async () => {
    setMessage(null);
    try {
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body: { username, password, nickname: nickname || undefined } });
      }
      // dev 入口 flag 关闭时走隐藏通道（两通道同一账密逻辑）
      const path = hidden || devDisabled ? '/auth/login/password' : '/auth/login/dev';
      await api(path, { method: 'POST', body: { username, password } });
      await refreshUser();
      navigate(next);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const wechat = async () => {
    setMessage(null);
    try {
      await api('/auth/login/wechat', { method: 'POST' });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="auth-page" data-testid="login-page">
      <div className="auth-card">
        <h1>木搭图 Modatu</h1>
        <p className="muted">{hidden ? '隐藏登录页（线上测试通道）' : '登录以保存设计与导出清单'}</p>
        <div className="form">
          <label>
            用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} data-testid="username" />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="password"
            />
          </label>
          {mode === 'register' && (
            <label>
              昵称（可留空自动生成）
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
          )}
          <div className="row">
            <button onClick={submit} disabled={devDisabled} data-testid="submit">
              {mode === 'login' ? '登录' : '注册并登录'}
            </button>
            <button className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
            </button>
          </div>
          {!hidden && (
            <button className="link" onClick={wechat}>
              微信扫码登录
            </button>
          )}
          {message && <p className="error" data-testid="login-message">{message}</p>}
        </div>
      </div>
    </div>
  );
}

/** /login/hidden：固定路由，不在任何导航中暴露（spec-03 有意的产品决策）。 */
export function HiddenLoginPage() {
  return <LoginPage hidden />;
}

/** 占位：编辑器路由参数解析在 EditorPage。 */
export function LoginRedirectProbe() {
  const { id } = useParams();
  void id;
  return null;
}
