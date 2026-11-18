import { useEffect, useState, type FormEvent } from 'react';
import type { PredictionJob } from '@boatrace/contracts';
import { readEvaluationSession, ViewerError } from '../../shared/api/evaluations';
import ConnectionForm, { type ConnectionProps } from '../../shared/ui/ConnectionForm';
import { executionLabel, jobsPath, modes, parseJobList, requestValue, states, venues } from '../forecast/job-records';
import { formatJstTimestamp } from '../forecast/daily-presentation';
import './prediction-history.css';

type Reading = { token: string; revision: number };
type History = Reading & (
  { state: 'ready'; items: PredictionJob[] } |
  { state: 'error'; message: string }
);

export default function PredictionHistory({
  token: connectionToken, identity, onIdentity, onTokenChange, onOpenPrediction,
}: ConnectionProps & {onOpenPrediction: (id: string) => void}) {
  const token = connectionToken.trim();
  const [reading, setReading] = useState<Reading>();
  const [history, setHistory] = useState<History>();
  const revision = reading?.revision ?? 0;
  const readToken = (identity || reading?.token === token) ? token : '';
  const current = history?.token === token && history.revision === revision ? history : null;
  const loading = Boolean(readToken && !current);

  useEffect(() => {
    if (!readToken) return;
    const controller = new AbortController();
    const attempt = {token: readToken, revision};
    const timeout = window.setTimeout(() => {
      controller.abort();
      setHistory({...attempt, state: 'error', message: '読み込みが時間内に完了しませんでした。再読み込みしてください。'});
    }, 15_000);
    async function load() {
      try {
        const session = await readEvaluationSession(readToken);
        if (controller.signal.aborted) return;
        const value = await requestValue(readToken, jobsPath, controller.signal);
        const items = parseJobList(value);
        if (controller.signal.aborted) return;
        onIdentity?.(session);
        setHistory({...attempt, state: 'ready', items});
      } catch (error) {
        if (controller.signal.aborted) return;
        if ((error instanceof ViewerError && error.status === 401) ||
            (error instanceof Error && error.name === 'AuthenticationRequired')) {
          onIdentity?.(null);
        }
        setHistory({...attempt, state: 'error', message: error instanceof Error ? error.message : '予想履歴を読み込めませんでした。'});
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [readToken, revision, onIdentity]);

  function reload() {
    setReading(previous => ({token, revision: (previous?.revision ?? 0) + 1}));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (token && !loading) reload();
  }
  return <>
    <p><a href="#races">保存レースと保存予想を探す</a></p>
    <ConnectionForm compact token={connectionToken} identity={identity} onTokenChange={value => {
      setReading(undefined);
      setHistory(undefined);
      onTokenChange(value);
    }} onSubmit={submit} busy={loading} button="予想履歴を読む" />
    {(readToken || current) && <section className="panel" aria-label="予想の一覧" aria-busy={loading}>
      <div className="section-title"><div><h2>最近の予想依頼</h2><p>直近50件まで表示します。</p></div>
        <button type="button" className="secondary small" disabled={loading} onClick={reload}>再読み込み</button>
      </div>
      {loading && <p role="status">予想履歴を読み込んでいます…</p>}
      {current?.state === 'error' && <p role="alert" className="notice error">{current.message}</p>}
      {current?.state === 'ready' && (current.items.length === 0 ? <p>予想依頼の履歴はありません。</p> :
        <ul className="prediction-history-list">{current.items.map(item => {
          const request = item.request;
          const title = `${request.date} ${venues[Number(request.venueCode) - 1]} ${request.raceNumber}R`;
          return <li key={item.id}>
            <a href={`#forecast?job=${encodeURIComponent(item.id)}`} onClick={event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onOpenPrediction(item.id);
            }}><strong>{title}</strong><span>{modes[request.mode]} · {states[item.state]}</span></a>
            <small>{executionLabel(item)} · 受付 {formatJstTimestamp(item.createdAt)}</small>
          </li>;
        })}</ul>)}
    </section>}
  </>;
}
