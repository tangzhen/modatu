import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

interface AiSettings {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
  apiKeyMasked: string | null;
}

/** AI BYOK 设置（spec-06）：base_url + key + model；Key 加密存储、仅掩码回显。 */
export function SettingsPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api<AiSettings>('/ai/settings')
      .then((s) => {
        setSettings(s);
        setBaseUrl(s.baseUrl ?? '');
        setModel(s.model ?? '');
      })
      .catch((e) => setMessage(String(e)));
  }, []);

  const save = async () => {
    setMessage(null);
    try {
      await api('/ai/settings', {
        method: 'PUT',
        body: { baseUrl, model, apiKey: apiKey || undefined },
      });
      setSettings(await api<AiSettings>('/ai/settings'));
      setApiKey('');
      setMessage('已保存');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const clear = async () => {
    await api('/ai/settings', { method: 'DELETE' });
    setSettings({ configured: false, baseUrl: null, model: null, apiKeyMasked: null });
    setBaseUrl('');
    setModel('');
    setMessage('已清除配置');
  };

  return (
    <div className="page" data-testid="settings-page">
      <h1>设置 · AI 接入（BYOK）</h1>
      <p className="hint">
        一期仅支持 OpenAI 兼容协议。Key 加密存储，界面不明文回显；调用消耗你自己的 API 配额。
      </p>
      <div className="form">
        <label>
          API 地址 (base_url)
          <input
            placeholder="https://api.openai.com/v1"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            data-testid="base-url"
          />
        </label>
        <label>
          API Key {settings?.apiKeyMasked ? `（已配置：${settings.apiKeyMasked}，留空保持不变）` : ''}
          <input
            type="password"
            placeholder="sk-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="api-key"
          />
        </label>
        <label>
          模型名
          <input
            placeholder="gpt-4o-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            data-testid="model"
          />
        </label>
        <div className="row">
          <button onClick={save} data-testid="save-settings">
            保存
          </button>
          {settings?.configured && (
            <button className="danger" onClick={clear}>
              清除配置
            </button>
          )}
          <Link to="/editor">返回编辑器</Link>
        </div>
        {message && <p className="hint">{message}</p>}
      </div>
    </div>
  );
}
