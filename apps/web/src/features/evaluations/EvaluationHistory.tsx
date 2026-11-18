import type { FormEvent } from 'react';
import ConnectionForm, { type ConnectionProps } from '../../shared/ui/ConnectionForm';
import useEvaluationRecords from './useEvaluationRecords';
import { EvaluationRecords, EvaluationRecordDetail } from './EvaluationRecords';

export default function EvaluationHistory(connection: ConnectionProps) {
  const records = useEvaluationRecords(connection);
  function load(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void records.loadList(); }
  return <>
    <ConnectionForm identity={connection.identity} token={connection.token} onTokenChange={value => { connection.onTokenChange(value); records.clear(); }} onSubmit={load} busy={records.busy} button="評価の履歴を読む" />
    <div id="history-results" aria-busy={records.busy}>
      {records.error && <div className="notice error" role="alert">{records.error} 以前の数値は表示していません。</div>}
      {records.busy && <p className="operation-status" role="status">保存記録を読み込んでいます。評価の再計算は行いません。</p>}
      {records.list && <EvaluationRecords value={records.list} busy={records.busy} selectedId={records.selectedId} onSelect={id => void records.loadDetail(id)} onNext={cursor => void records.loadList(cursor)} onFirst={() => void records.loadList()} />}
      {records.detail && <EvaluationRecordDetail value={records.detail} />}
      {!records.list && !records.detail && !records.busy && !records.error && <section className="state-panel"><h2>過去の評価を、条件ごとに確認</h2><p>「評価の履歴を読む」で閲覧対象の一覧を取得します。画面を開くだけでは通信しません。</p></section>}
    </div>
  </>;
}
