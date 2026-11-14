import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../stores/auth';
import {
  buildParametricCrossSection,
  isValidCrossSection,
  loopsToSvgPath,
  type CrossSectionSource,
  type ProfileCrossSection,
  type ProfileSpec,
  type Connector,
  type Compatibility,
  type PanelMaterial,
  type SafetyRule,
} from '@modatu/catalog';

/**
 * 后台知识库维护（spec-01）：五类实体的增改 + 停用/启用。
 * 停用采用软停用（enabled 标志），无物理删除；兼容矩阵行可删（矩阵维护）。
 */

type Tab = 'profiles' | 'connectors' | 'compatibilities' | 'materials' | 'rules';

export function AdminCatalogPage() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('profiles');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== 'admin') navigate('/designs');
  }, [user, navigate]);

  return (
    <div className="page" data-testid="admin-catalog">
      <h1>后台 · 材料知识库</h1>
      <nav className="tabs">
        {(
          [
            ['profiles', '型材规格'],
            ['connectors', '连接件'],
            ['compatibilities', '兼容矩阵'],
            ['materials', '板材材质'],
            ['rules', '安全规则'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <Link to="/admin/users">用户管理</Link>
        <Link to="/designs">我的设计</Link>
      </nav>
      {message && <p className="error">{message}</p>}
      {tab === 'profiles' && <ProfilesTab onError={setMessage} />}
      {tab === 'connectors' && <ConnectorsTab onError={setMessage} />}
      {tab === 'compatibilities' && <CompatTab onError={setMessage} />}
      {tab === 'materials' && <MaterialsTab onError={setMessage} />}
      {tab === 'rules' && <RulesTab onError={setMessage} />}
    </div>
  );
}

function useAdminApi() {
  const [rows, setRows] = useState<unknown[]>([]);
  const [keyword, setKeyword] = useState('');
  const reload = async (path: string) => {
    const q = keyword ? `?q=${encodeURIComponent(keyword)}` : '';
    const data = await api<unknown[]>(`/admin/catalog/${path}${q}`);
    setRows(data);
  };
  return { rows, setRows, keyword, setKeyword, reload };
}

/* --------------------------------- 型材规格 --------------------------------- */

/** 截面 SVG 预览：优先精确环数据，否则参数化近似 */
function SectionPreview({
  spec,
  size,
}: {
  spec: { width?: number; height?: number; slotWidth?: number; crossSection?: ProfileCrossSection | null };
  size: number;
}) {
  const w = Number(spec.width) || 20;
  const h = Number(spec.height) || 20;
  const slot = Number(spec.slotWidth) || 6;
  const section =
    spec.crossSection && isValidCrossSection(spec.crossSection)
      ? spec.crossSection
      : buildParametricCrossSection({ width: w, height: h, slotWidth: slot });
  const d = loopsToSvgPath(section.loops, true);
  const pad = Math.max(w, h) * 0.06;
  const stroke = Math.max(w, h) / 200;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-w / 2 - pad} ${-h / 2 - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      style={{ maxWidth: '100%', verticalAlign: 'middle' }}
      data-testid="section-preview"
    >
      <path d={d} fill="#9aa5b1" fillRule="evenodd" stroke="#5b6770" strokeWidth={stroke} />
    </svg>
  );
}

function ProfilesTab({ onError }: { onError: (m: string) => void }) {
  const { rows, keyword, setKeyword, reload } = useAdminApi();
  const [draft, setDraft] = useState<
    Omit<Partial<ProfileSpec>, 'crossSection' | 'crossSectionSource'> & {
      loadRatingsText?: string;
      crossSection?: ProfileCrossSection | null;
      crossSectionSource?: CrossSectionSource | null;
    }
  >({
    code: '',
    series: '',
    width: 20,
    height: 20,
    slotWidth: 6,
    slotDepth: 5.2,
    massPerMeter: 0.5,
    minCutLength: 20,
    maxCutLength: 3000,
    loadRatingsText: '1000:5, 500:15',
    enabled: true,
  });
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  useEffect(() => {
    void reload('profiles').catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const save = async () => {
    const ratings = (draft.loadRatingsText ?? '')
      .split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [span, load] = pair.split(':').map((n) => Number(n.trim()));
        return { span, load };
      })
      .filter((r) => Number.isFinite(r.span) && Number.isFinite(r.load));
    try {
      await api('/admin/catalog/profiles', {
        method: 'PUT',
        body: { ...draft, loadRatings: ratings },
      });
      await reload('profiles');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = async (row: ProfileSpec) => {
    await api(`/admin/catalog/profiles/${row.id}/enabled`, {
      method: 'PUT',
      body: { enabled: !row.enabled },
    });
    await reload('profiles');
  };

  return (
    <div>
      <div className="row">
        <input placeholder="搜索代号/系列" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr>
            <th>代号</th>
            <th>系列</th>
            <th>截面</th>
            <th>截面预览</th>
            <th>槽宽/深</th>
            <th>kg/m</th>
            <th>切割范围</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {(rows as ProfileSpec[]).map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td>
              <td>{r.series}</td>
              <td>
                {r.width}×{r.height}
              </td>
              <td>
                <SectionPreview spec={r} size={44} />
              </td>
              <td>
                {r.slotWidth}/{r.slotDepth}
              </td>
              <td>{r.massPerMeter}</td>
              <td>
                [{r.minCutLength}, {r.maxCutLength}]
              </td>
              <td>{r.enabled ? '启用' : '停用'}</td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td>
                <button onClick={() => setDraft({ ...r, loadRatingsText: r.loadRatings.map((x) => `${x.span}:${x.load}`).join(', ') })}>
                  编辑
                </button>
                <button onClick={() => void toggle(r)}>{r.enabled ? '停用' : '启用'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{draft.id ? '编辑规格' : '新增规格'}</h3>
      <div className="form grid">
        {(
          [
            ['code', '代号'],
            ['series', '系列'],
            ['width', '截面宽'],
            ['height', '截面高'],
            ['slotWidth', '槽宽'],
            ['slotDepth', '槽深'],
            ['massPerMeter', 'kg/m'],
            ['minCutLength', '切割下限'],
            ['maxCutLength', '切割上限'],
          ] as Array<[keyof typeof draft, string]>
        ).map(([key, label]) => (
          <label key={String(key)}>
            {label}
            <input
              value={String(draft[key] ?? '')}
              onChange={(e) =>
                setDraft({ ...draft, [key]: Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })
              }
            />
          </label>
        ))}
        <label>
          承重参考（跨度:kg，逗号分隔）
          <input
            value={draft.loadRatingsText ?? ''}
            onChange={(e) => setDraft({ ...draft, loadRatingsText: e.target.value })}
          />
        </label>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div style={{ marginBottom: 4 }}>截面预览（精确环数据 / 参数化近似）</div>
            <SectionPreview spec={draft} size={140} />
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              {draft.crossSection ? '已设置精确截面' : '未设置精确截面（渲染用参数化近似）'}
            </div>
            <div style={{ marginTop: 6 }}>
              <label
                style={{
                  cursor: importing ? 'wait' : 'pointer',
                  display: 'inline-block',
                  padding: '4px 10px',
                  border: '1px solid #64748b',
                  borderRadius: 4,
                  background: '#f1f5f9',
                }}
              >
                {importing ? '解析中…' : '导入截面 DXF/SVG'}
                <input
                  type="file"
                  accept=".dxf,.svg"
                  style={{ display: 'none' }}
                  disabled={importing}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    void (async () => {
                      setImporting(true);
                      setImportNote(null);
                      try {
                        const { importSectionFile } = await import('../lib/import-cross-section');
                        const result = await importSectionFile(file, {
                          width: Number(draft.width) || 20,
                          height: Number(draft.height) || 20,
                        });
                        setDraft({ ...draft, crossSection: result.crossSection, crossSectionSource: result.source });
                        setImportNote(
                          result.aspectMismatch
                            ? `已导入，但纵横比与规格 ${draft.width}×${draft.height} 不符——请确认是否导错图纸`
                            : `已导入 ${result.rawLoopCount} 个环（1 外轮廓 + ${result.rawLoopCount - 1} 孔）`,
                        );
                      } catch (err) {
                        setImportNote(`导入失败：${err instanceof Error ? err.message : String(err)}`);
                      } finally {
                        setImporting(false);
                      }
                    })();
                  }}
                />
              </label>
              {draft.crossSection !== undefined && (
                <button
                  onClick={() => {
                    setDraft({ ...draft, crossSection: null, crossSectionSource: null });
                    setImportNote('将在保存后清除精确截面（回落到参数化近似）');
                  }}
                >
                  清除截面
                </button>
              )}
            </div>
            {importNote && <p className="hint">{importNote}</p>}
          </div>
        </div>
        <div className="row">
          <button onClick={save}>保存</button>
          <button
            onClick={() => {
              setDraft({
                code: '',
                series: '',
                width: 20,
                height: 20,
                slotWidth: 6,
                slotDepth: 5.2,
                massPerMeter: 0.5,
                minCutLength: 20,
                maxCutLength: 3000,
                loadRatingsText: '',
                crossSection: undefined,
                crossSectionSource: undefined,
                enabled: true,
              });
              setImportNote(null);
            }}
          >
            清空（新增模式）
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- 连接件 ---------------------------------- */

function ConnectorsTab({ onError }: { onError: (m: string) => void }) {
  const { rows, keyword, setKeyword, reload } = useAdminApi();
  const [draft, setDraft] = useState<Partial<Connector>>({ name: '', category: 'corner-bracket', enabled: true });

  useEffect(() => {
    void reload('connectors').catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const save = async () => {
    try {
      await api('/admin/catalog/connectors', { method: 'PUT', body: draft });
      await reload('connectors');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = async (row: Connector) => {
    await api(`/admin/catalog/connectors/${row.id}/enabled`, { method: 'PUT', body: { enabled: !row.enabled } });
    await reload('connectors');
  };

  return (
    <div>
      <div className="row">
        <input placeholder="搜索名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>类别</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {(rows as Connector[]).map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.name}</td>
              <td>{r.category}</td>
              <td>{r.enabled ? '启用' : '停用'}</td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td>
                <button onClick={() => setDraft(r)}>编辑</button>
                <button onClick={() => void toggle(r)}>{r.enabled ? '停用' : '启用'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{draft.id ? '编辑连接件' : '新增连接件'}</h3>
      <div className="form">
        <label>
          名称
          <input value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          类别
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Connector['category'] })}>
            <option value="corner-bracket">角码</option>
            <option value="t-bolt">T 型螺栓/螺母</option>
            <option value="other">其他</option>
          </select>
        </label>
        <div className="row">
          <button onClick={save}>保存</button>
          <button onClick={() => setDraft({ name: '', category: 'corner-bracket', enabled: true })}>清空（新增模式）</button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- 兼容矩阵 --------------------------------- */

function CompatTab({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<Compatibility[]>([]);
  const [draft, setDraft] = useState<Partial<Compatibility>>({
    connectorId: '',
    profileCodeA: '',
    profileCodeB: '',
    quantityPerJoint: 2,
  });

  useEffect(() => {
    void api<Compatibility[]>('/admin/catalog/compatibilities')
      .then(setRows)
      .catch(onError);
  }, [onError]);

  const save = async () => {
    try {
      await api('/admin/catalog/compatibilities', { method: 'PUT', body: draft });
      setRows(await api<Compatibility[]>('/admin/catalog/compatibilities'));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string) => {
    await api(`/admin/catalog/compatibilities/${id}`, { method: 'DELETE' });
    setRows(await api<Compatibility[]>('/admin/catalog/compatibilities'));
  };

  return (
    <div>
      <p className="hint">矩阵语义：规格 A × 规格 B 可用某连接件（方向对称），每个连接点需 quantityPerJoint 件。</p>
      <table>
        <thead>
          <tr>
            <th>连接件</th>
            <th>规格 A</th>
            <th>规格 B</th>
            <th>每接点数量</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.connectorId}</td>
              <td>{r.profileCodeA}</td>
              <td>{r.profileCodeB}</td>
              <td>{r.quantityPerJoint}</td>
              <td>
                <button onClick={() => setDraft(r)}>编辑</button>
                <button className="danger" onClick={() => void remove(r.id)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{draft.id ? '编辑兼容行' : '新增兼容行'}</h3>
      <div className="form grid">
        <label>
          连接件 ID
          <input value={draft.connectorId ?? ''} onChange={(e) => setDraft({ ...draft, connectorId: e.target.value })} />
        </label>
        <label>
          规格 A 代号
          <input value={draft.profileCodeA ?? ''} onChange={(e) => setDraft({ ...draft, profileCodeA: e.target.value })} />
        </label>
        <label>
          规格 B 代号
          <input value={draft.profileCodeB ?? ''} onChange={(e) => setDraft({ ...draft, profileCodeB: e.target.value })} />
        </label>
        <label>
          每接点数量
          <input
            type="number"
            step={1}
            value={draft.quantityPerJoint ?? 2}
            onChange={(e) => setDraft({ ...draft, quantityPerJoint: Number(e.target.value) })}
          />
        </label>
        <div className="row">
          <button onClick={save}>保存</button>
          <button
            onClick={() => setDraft({ connectorId: '', profileCodeA: '', profileCodeB: '', quantityPerJoint: 2 })}
          >
            清空（新增模式）
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- 板材材质 --------------------------------- */

function MaterialsTab({ onError }: { onError: (m: string) => void }) {
  const { rows, keyword, setKeyword, reload } = useAdminApi();
  const [draft, setDraft] = useState<Partial<PanelMaterial> & { thicknessesText?: string }>({
    name: '',
    thicknessesText: '9, 12, 15, 18',
    density: 0.55,
    enabled: true,
  });

  useEffect(() => {
    void reload('panel-materials').catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const save = async () => {
    const thicknesses = (draft.thicknessesText ?? '')
      .split(',')
      .map((t) => Number(t.trim()))
      .filter((t) => Number.isFinite(t) && t > 0);
    try {
      await api('/admin/catalog/panel-materials', { method: 'PUT', body: { ...draft, thicknesses } });
      await reload('panel-materials');
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = async (row: PanelMaterial) => {
    await api(`/admin/catalog/panel-materials/${row.id}/enabled`, { method: 'PUT', body: { enabled: !row.enabled } });
    await reload('panel-materials');
  };

  return (
    <div>
      <div className="row">
        <input placeholder="搜索名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>厚度列表</th>
            <th>密度</th>
            <th>状态</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {(rows as PanelMaterial[]).map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.name}</td>
              <td>{r.thicknesses.join(' / ')}</td>
              <td>{r.density}</td>
              <td>{r.enabled ? '启用' : '停用'}</td>
              <td>{new Date(r.updatedAt).toLocaleString()}</td>
              <td>
                <button
                  onClick={() =>
                    setDraft({ ...r, thicknessesText: r.thicknesses.join(', ') })
                  }
                >
                  编辑
                </button>
                <button onClick={() => void toggle(r)}>{r.enabled ? '停用' : '启用'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{draft.id ? '编辑材质' : '新增材质'}</h3>
      <div className="form grid">
        <label>
          名称
          <input value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          常用厚度（mm，逗号分隔）
          <input
            value={draft.thicknessesText ?? ''}
            onChange={(e) => setDraft({ ...draft, thicknessesText: e.target.value })}
          />
        </label>
        <label>
          密度 (g/cm³)
          <input
            type="number"
            step={0.05}
            value={draft.density ?? 0.5}
            onChange={(e) => setDraft({ ...draft, density: Number(e.target.value) })}
          />
        </label>
        <div className="row">
          <button onClick={save}>保存</button>
          <button
            onClick={() => setDraft({ name: '', thicknessesText: '', density: 0.5, enabled: true })}
          >
            清空（新增模式）
          </button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- 安全规则 --------------------------------- */

function RulesTab({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<SafetyRule[]>([]);
  const [draft, setDraft] = useState<Partial<SafetyRule> & { maxSpan?: number }>({
    ruleType: 'max-unsupported-span',
    maxSpan: 1500,
    messageTemplate: '部件 {partId}（{specCode}）跨度 {span}mm 超过建议最大无支撑跨度 {maxSpan}mm，建议增加立柱或更换重载型材。',
    enabled: true,
  });

  useEffect(() => {
    void api<SafetyRule[]>('/admin/catalog/safety-rules')
      .then(setRows)
      .catch(onError);
  }, [onError]);

  const save = async () => {
    try {
      await api('/admin/catalog/safety-rules', {
        method: 'PUT',
        body: { ...draft, params: { maxSpan: draft.maxSpan ?? 1500 } },
      });
      setRows(await api<SafetyRule[]>('/admin/catalog/safety-rules'));
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = async (row: SafetyRule) => {
    await api(`/admin/catalog/safety-rules/${row.id}/enabled`, { method: 'PUT', body: { enabled: !row.enabled } });
    setRows(await api<SafetyRule[]>('/admin/catalog/safety-rules'));
  };

  return (
    <div>
      <p className="hint">规则为数据驱动（规则类型 + JSON 参数 + 文案模板，模板支持 {'{参数}'} 插值），由编辑器求值展示。</p>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>类型</th>
            <th>参数</th>
            <th>模板</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.ruleType}</td>
              <td>{JSON.stringify(r.params)}</td>
              <td className="clip">{r.messageTemplate}</td>
              <td>{r.enabled ? '启用' : '停用'}</td>
              <td>
                <button onClick={() => setDraft({ ...r, maxSpan: Number(r.params['maxSpan'] ?? 1500) })}>编辑</button>
                <button onClick={() => void toggle(r)}>{r.enabled ? '停用' : '启用'}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{draft.id ? '编辑规则' : '新增规则'}</h3>
      <div className="form">
        <label>
          规则类型
          <select
            value={draft.ruleType}
            onChange={(e) => setDraft({ ...draft, ruleType: e.target.value as SafetyRule['ruleType'] })}
          >
            <option value="max-unsupported-span">最大无支撑跨度</option>
            <option value="panel-span-load">层板跨度承重提醒</option>
          </select>
        </label>
        <label>
          maxSpan 参数 (mm)
          <input
            type="number"
            step={50}
            value={draft.maxSpan ?? 1500}
            onChange={(e) => setDraft({ ...draft, maxSpan: Number(e.target.value) })}
          />
        </label>
        <label>
          文案模板（支持 {'{partId}'} {'{specCode}'} {'{span}'} {'{maxSpan}'})
          <textarea
            rows={2}
            value={draft.messageTemplate ?? ''}
            onChange={(e) => setDraft({ ...draft, messageTemplate: e.target.value })}
          />
        </label>
        <div className="row">
          <button onClick={save}>保存</button>
          <button onClick={() => setDraft({ ruleType: 'max-unsupported-span', maxSpan: 1500, messageTemplate: '', enabled: true })}>
            清空（新增模式）
          </button>
        </div>
      </div>
    </div>
  );
}
