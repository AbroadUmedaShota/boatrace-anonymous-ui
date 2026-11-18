import type { EvaluationListResponse, EvaluationDetailResponse } from '@boatrace/contracts';
import EvaluationView from './EvaluationView';
import { timestamp } from './format';
import { sourceLabel } from './CloudCandidate';

export const visibilityLabels = { PRIVATE: '非公開（閲覧不可）', VISIBLE: '閲覧可', SUPERSEDED: '置換済み（閲覧対象外）', WITHDRAWN: '撤回（閲覧対象外）' };
const registrationLabels: Record<string, string> = { RECEIVING: '受信中', STAGED: '登録準備', VERIFIED: '検査済み', REGISTERED: '登録完了', HELD: '保留', FAILED: '登録失敗' };

export function EvaluationRecords({ value, busy, selectedId, onSelect, onNext, onFirst, admin = false }: {
  value: EvaluationListResponse; busy: boolean; selectedId: string; onSelect: (id: string) => void;
  onNext: (cursor: string) => void; onFirst: () => void; admin?: boolean;
}) {
  return <section className="panel" aria-labelledby="records-heading"><div className="section-title"><div><h2 id="records-heading">{admin ? '登録された評価の管理一覧' : '閲覧できる評価の履歴'}</h2><p>{admin ? '管理権限で全登録状態を確認しています。登録状態と閲覧許可は別の項目です。' : '登録完了かつ閲覧対象の評価だけを表示します。最新以外の評価も閲覧できます。'}</p></div></div>
    {value.items.length === 0 ? <p id="records-empty" className="empty-records">{admin ? 'このページに登録評価はありません。' : 'このページに閲覧できる評価はありません。非公開の評価数や状態は表示しません。'}</p> : <div className="table-scroll record-scroll" tabIndex={0} role="region" aria-label="保存評価の一覧"><table id="evaluation-records"><thead><tr><th scope="col">評価・対象期間</th><th scope="col">登録状態</th><th scope="col">閲覧許可</th><th scope="col">最新</th><th scope="col">詳細</th></tr></thead><tbody>{value.items.map(item => <tr key={item.evaluation_id} className={item.evaluation_id === selectedId ? 'selected-record' : ''}><th scope="row"><code>{item.evaluation_id}</code><span className="record-period">{item.summary?.period ? `${item.summary.period.start} ～ ${item.summary.period.end}` : '対象期間は未確認'}</span><span className="record-period">モデル作成 {timestamp(item.summary?.model_created_at ?? null)}</span><span className="record-period" data-record-source={item.source_type ?? 'LEGACY_TRANSFER'}>{sourceLabel(item.source_type)}</span></th><td>{registrationLabels[item.registration_state] || item.registration_state}<small>{item.registration_state}</small></td><td>{visibilityLabels[item.visibility]}<small>{item.visibility}</small></td><td>{item.is_latest ? <span className="tag">最新の指定</span> : '—'}</td><td><button type="button" className="secondary small" data-evaluation-id={item.evaluation_id} disabled={busy} onClick={() => onSelect(item.evaluation_id)}>詳細を見る</button></td></tr>)}</tbody></table></div>}
    <div className="pagination"><button type="button" className="secondary small" disabled={busy} onClick={onFirst}>先頭を再読込</button><button type="button" className="secondary small" disabled={busy || !value.next_cursor} onClick={() => value.next_cursor && onNext(value.next_cursor)}>次のページ</button><span>最新の指定を変えても、旧評価が自動で閲覧対象外になることはありません。</span></div>
  </section>;
}

export function EvaluationRecordDetail({ value }: { value: EvaluationDetailResponse }) {
  return <div id="record-detail"><section className="panel detail-status"><h2>選択した保存評価</h2><dl className="identity-list"><dt>対象の評価ID</dt><dd id="selected-evaluation-id"><code>{value.evaluation_id}</code></dd><dt>資料の形式</dt><dd id="detail-source-type">{sourceLabel(value.source_type)}</dd><dt>登録状態</dt><dd>{registrationLabels[value.registration_state]}（{value.registration_state}）</dd><dt>閲覧許可</dt><dd>{visibilityLabels[value.visibility]}（{value.visibility}）</dd><dt>最新の指定</dt><dd>{value.is_latest ? 'この評価が指定されています' : 'この評価は指定されていません'}</dd></dl><p className="muted">閲覧許可は閲覧範囲の指定です。予測の有用性・運用・購入の承認を意味しません。</p></section>
    {value.status === 'AVAILABLE' && value.summary && value.provenance ? <EvaluationView value={{ status: 'AVAILABLE', evaluation_id: value.evaluation_id, summary: value.summary, provenance: value.provenance, source_type: value.source_type }} /> : <section id="detail-held" className="state-panel warning" role="status"><h2>この評価の数値表示は保留です</h2><p>登録・保存証跡の状態を確認してください。未確認の値は表示しません。</p><ul className="reason-list">{value.reasons.map((reason, index) => <li key={`${reason}-${index}`}><code>{reason}</code></li>)}</ul></section>}
  </div>;
}
