import { useState, type FormEvent } from 'react';
import type { LatestEvaluationResponse } from '@boatrace/contracts';
import { readLatestEvaluation, readEvaluationSession } from '../../shared/api/evaluations';
import EvaluationView from './EvaluationView';
import ConnectionForm, { type ConnectionProps } from '../../shared/ui/ConnectionForm';

type ScreenState = { kind: 'idle' | 'loading' } | { kind: 'loaded'; value: LatestEvaluationResponse } | { kind: 'error'; message: string };

function StatusPanel({ state }: { state: ScreenState }) {
  if (state.kind === 'loaded') {
    if (state.value.status === 'AVAILABLE') return <EvaluationView value={state.value} />;
    return <section id="viewer-state" className={`state-panel ${state.value.status === 'HELD' ? 'warning' : ''}`} role="status">
      <span className="state-symbol" aria-hidden="true">{state.value.status === 'EMPTY' ? '—' : '!'}</span>
      <h2>{state.value.status === 'EMPTY' ? '閲覧対象の評価は未指定です' : '保存評価の表示を保留しています'}</h2>
      <p>{state.value.status === 'EMPTY' ? '閲覧対象の評価がまだ指定されていません。管理者が対象を指定した後に、もう一度読み込んでください。' : '資料の不足・不整合を確認してください。未確認の数値は表示しません。'}</p>
      {state.value.reasons.length > 0 && <ul className="reason-list">{state.value.reasons.map((reason, index) => <li key={`${reason}-${index}`}><code>{reason}</code></li>)}</ul>}
      <p className="muted">この画面では学習・評価の再実行やデータ取得は行いません。</p>
    </section>;
  }
  if (state.kind === 'error') return <section id="viewer-state" className="state-panel error" role="alert"><span className="state-symbol" aria-hidden="true">!</span><h2>保存評価を読み込めませんでした</h2><p>{state.message}</p><p className="muted">以前の数値は表示していません。確認後に「保存済み評価を読む」で読み直してください。</p></section>;
  return <section id="viewer-state" className={`state-panel ${state.kind === 'loading' ? 'loading' : ''}`} role="status" aria-live="polite"><span className="state-symbol" aria-hidden="true">{state.kind === 'loading' ? '…' : '≋'}</span><h2>{state.kind === 'loading' ? '保存済み評価を読み込んでいます' : '保存された結果を、そのまま確認'}</h2><p>{state.kind === 'loading' ? '保存資料を参照しています。評価の再計算は行いません。' : '閲覧トークンを入力して読み込んでください。対象期間・比較条件・保留事項をひとつの画面で確認できます。'}</p></section>;
}

export default function EvaluationWorkspace({ token, onTokenChange, onBusyChange, identity, onIdentity }: ConnectionProps) {
  const [state, setState] = useState<ScreenState>({ kind: 'idle' });
  const busy = state.kind === 'loading';

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token.trim()) return;
    setState({ kind: 'loading' });
    onIdentity?.(null);
    onBusyChange(true);
    try {
      const value = await readLatestEvaluation(token.trim());
      if (value.status === 'AVAILABLE' && value.source_type === 'CLOUD_VIEW') onIdentity?.(await readEvaluationSession(token.trim()));
      setState({ kind: 'loaded', value });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : '読込状態は未確認です。' });
    } finally {
      onBusyChange(false);
    }
  }

  return <>
      <ConnectionForm identity={identity} token={token} onTokenChange={value => { onTokenChange(value); setState({ kind: 'idle' }); }} onSubmit={load} busy={busy} />
      <div id="results" aria-busy={busy}><StatusPanel state={state} /></div>
  </>;
}
