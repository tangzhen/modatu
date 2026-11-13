import { useState } from 'react';
import { useEditor } from '../stores/editor';
import { api } from '../api';
import type { ModelDiffEntry } from '@modatu/design-model';

interface AiRunResponse {
  proposal: { design: import('@modatu/design-model').DesignModel; unsatisfied: Array<{ requirement: string; reason: string }> };
  diff: { entries: ModelDiffEntry[]; isEmpty: boolean } | null;
  attempts: number;
  errors: string[];
}

/**
 * AI 面板（spec-06）：生成新设计 / 修改当前设计。
 * 修改先以 diff 预览呈现，用户点「应用」才生效（走编辑器状态层管道）。
 */
export function AiPanel({ onClose, onOpenDiff }: { onClose: () => void; onOpenDiff: () => void }) {
  const { designId, model, replaceModel } = useEditor();
  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiRunResponse | null>(null);

  const run = async (kind: 'generate' | 'modify') => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (kind === 'generate') {
        const res = await api<AiRunResponse>('/ai/generate', { method: 'POST', body: { prompt } });
        setResult(res);
      } else {
        const body = designId ? { designId, instruction } : { model, instruction };
        const res = await api<AiRunResponse>('/ai/modify', { method: 'POST', body });
        setResult(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    const op = replaceModel(result.proposal.design, 'AI 修改（已确认应用）');
    if (!op.ok) {
      setError(`应用被拒绝：${op.reason}`);
      return;
    }
    setResult(null);
    onOpenDiff();
  };

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal ai" onClick={(e) => e.stopPropagation()} data-testid="ai-panel">
        <div className="modal-head">
          <h2>AI 生成 / 修改（BYOK）</h2>
          <button onClick={onClose}>关闭</button>
        </div>
        <p className="hint">需先在「设置」中配置 API 地址、Key 与模型名（消耗你自己的 API 配额）。</p>

        <div className="form">
          <label>
            {designId || model.profiles.length > 0 ? '修改指令（针对当前设计）' : '描述你想要的家具'}
            <textarea
              rows={2}
              placeholder={
                designId || model.profiles.length > 0
                  ? '例如：加一层层板 / 右边留出 30cm 挂衣区'
                  : '例如：1.2 米宽、2 米高的三列书架'
              }
              value={designId || model.profiles.length > 0 ? instruction : prompt}
              onChange={(e) =>
                designId || model.profiles.length > 0 ? setInstruction(e.target.value) : setPrompt(e.target.value)
              }
            />
          </label>
          <div className="row">
            <button
              onClick={() => run('generate')}
              disabled={busy || (designId || model.profiles.length > 0 ? false : prompt.trim().length < 2)}
            >
              {busy ? 'AI 生成中…' : '生成新设计'}
            </button>
            <button
              onClick={() => run('modify')}
              disabled={busy || instruction.trim().length < 2}
              data-testid="ai-modify"
            >
              修改当前设计
            </button>
          </div>
        </div>

        {error && <p className="error" data-testid="ai-error">{error}</p>}

        {result && (
          <div className="ai-result" data-testid="ai-result">
            <h3>AI 提案预览</h3>
            {result.diff && !result.diff.isEmpty ? (
              <div>
                <h4>变更预览（系统对比计算，点「应用」才生效）</h4>
                <ul className="diff-list">
                  {result.diff.entries.map((e) => (
                    <li key={`${e.kind}-${e.id}`} className={`diff-${e.kind}`}>
                      {e.kind === 'added' && '➕ 新增'}
                      {e.kind === 'removed' && '➖ 删除'}
                      {e.kind === 'changed' && '✏️ 修改'}
                      {e.kind !== 'changed' ? ` ${e.label}` : ` ${e.label}（${(e as { changes: unknown[] }).changes.length} 处字段）`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="hint">全新设计，无 diff（应用后进入编辑器）</p>
            )}
            {result.proposal.unsatisfied.length > 0 && (
              <div className="warning-list" data-testid="ai-unsatisfied">
                <h4>未满足的需求（近似实现）</h4>
                {result.proposal.unsatisfied.map((u) => (
                  <p key={u.requirement}>
                    ⚠ {u.requirement}：{u.reason}
                  </p>
                ))}
              </div>
            )}
            <div className="row">
              <button onClick={apply} data-testid="ai-apply">
                应用到编辑器
              </button>
              <button className="danger" onClick={() => setResult(null)}>
                放弃（无损拒绝）
              </button>
            </div>
            <p className="muted">尝试次数 {result.attempts}</p>
          </div>
        )}
      </div>
    </div>
  );
}
