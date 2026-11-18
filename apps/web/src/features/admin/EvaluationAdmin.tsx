import { useState, type FormEvent } from 'react';
import ConnectionForm, { type ConnectionProps } from '../../shared/ui/ConnectionForm';
import ActionConfirmation from '../../shared/ui/ActionConfirmation';
import { changeVisibility, selectLatest, readEvaluationSession, ViewerError, type Visibility } from '../../shared/api/evaluations';
import useEvaluationRecords from '../evaluations/useEvaluationRecords';
import { EvaluationRecords, EvaluationRecordDetail, visibilityLabels } from '../evaluations/EvaluationRecords';

type Permission = 'unchecked' | 'checking' | 'admin' | 'viewer' | 'registrar' | 'compute' | 'error';
type Action = { kind: 'visibility'; id: string; from: Visibility; to: Visibility; wasLatest: boolean } | { kind: 'latest'; id: string; from: Visibility };

export default function EvaluationAdmin(connection: ConnectionProps) {
  const records = useEvaluationRecords(connection, true);
  const [permission, setPermission] = useState<Permission>('unchecked');
  const [draft, setDraft] = useState<Visibility | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState('');
  const busy = permission === 'checking' || records.busy || writing;
  const detail = records.detail;
  const meetsManagementConditions = permission === 'admin' && detail?.registration_state === 'REGISTERED' && detail.status === 'AVAILABLE';
  const canManage = meetsManagementConditions && !busy;
  const nextVisibility = draft ?? detail?.visibility ?? 'PRIVATE';

  function reset() { records.clear(); setPermission('unchecked'); setDraft(null); setAction(null); setMessage(''); }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !connection.token.trim()) return;
    records.clear(); setDraft(null); setAction(null); setMessage(''); setPermission('checking'); connection.onBusyChange(true);
    try {
      const identity = await readEvaluationSession(connection.token.trim());
      connection.onIdentity?.(identity);
      setPermission(identity.role);
      if (identity.role === 'admin') await records.loadList();
      else setMessage('管理者権限がないため、管理一覧・変更操作は利用できません。評価の履歴は閲覧用画面で確認してください。');
    } catch (error) {
      connection.onIdentity?.(null); setPermission('error'); setMessage(error instanceof Error ? error.message : '権限を確認できませんでした。');
    } finally { connection.onBusyChange(false); }
  }

  function inspect(id: string) { if (busy || permission !== 'admin') return; setDraft(null); setAction(null); setMessage(''); void records.loadDetail(id); }
  function list(cursor?: string) { if (busy || permission !== 'admin') return; setDraft(null); setAction(null); setMessage(''); void records.loadList(cursor); }

  async function commit() {
    if (!action || writing || permission !== 'admin') return;
    const selected = action;
    setWriting(true); connection.onBusyChange(true); setMessage('');
    try {
      if (selected.kind === 'visibility') await changeVisibility(connection.token.trim(), selected.id, selected.to);
      else await selectLatest(connection.token.trim(), selected.id);
      setAction(null); setDraft(null);
      await records.loadList();
      setMessage(`対象 ${selected.id} の${selected.kind === 'visibility' ? '閲覧許可を変更しました' : '最新の指定を変更しました'}。一覧・詳細を読み直して保存状態を確認してください。`);
    } catch (error) {
      records.clear(); setAction(null); setDraft(null);
      if (error instanceof ViewerError && (error.status === 401 || error.status === 403)) { connection.onIdentity?.(null); setPermission('error'); }
      setMessage(`変更の完了は未確認です。自動再送せず、権限と保存状態を読み直してください。${error instanceof Error ? error.message : ''}`);
    } finally { setWriting(false); connection.onBusyChange(false); }
  }

  const permissionLabel: Record<Permission, string> = { unchecked: '未確認', checking: '確認中', admin: '管理者', viewer: '閲覧者（管理権限なし）', registrar: '登録用（管理権限なし）', compute: '計算サービス（管理権限なし）', error: '未確認・操作保留' };
  return <>
    <ConnectionForm identity={connection.identity} token={connection.token} onTokenChange={value => { connection.onTokenChange(value); reset(); }} onSubmit={connect} busy={busy} title="管理トークンで権限を確認" button="権限を確認して管理一覧を読む" />
    <section className="panel permission-panel"><h2>操作権限と評価の状態は別です</h2><p id="admin-permission" role="status">サーバーで確認した権限：<strong>{permissionLabel[permission]}</strong></p><p className="muted">トークンの文字列から権限を推測しません。登録完了・保存検査済みの評価だけを変更でき、閲覧可でも予測の有用性・購入を承認したことにはなりません。</p></section>
    <div id="admin-results" aria-busy={busy}>
      {message && <div id="admin-operation-message" className="notice neutral" role="status">{message}</div>}
      {records.error && <div className="notice error" role="alert">{records.error} 以前の数値は表示していません。</div>}
      {busy && !action && <p role="status" className="operation-status">権限・保存状態を確認しています。処理を自動再送しません。</p>}
      {permission === 'admin' && records.list && <EvaluationRecords value={records.list} busy={busy} selectedId={records.selectedId} onSelect={inspect} onNext={list} onFirst={() => list()} admin />}
      {permission === 'admin' && detail && <section className="panel admin-actions" aria-labelledby="admin-actions-heading"><h2 id="admin-actions-heading">選択した評価の管理操作</h2><p className="target-id">対象：<code>{detail.evaluation_id}</code></p><p className="muted">閲覧可（VISIBLE）だけが閲覧者の一覧・詳細に出ます。非公開・置換済み・撤回は履歴からも外れます。最新の切替は、旧評価の閲覧許可を自動変更しません。</p>
        <div className="admin-action-grid"><div><label htmlFor="visibility-choice">閲覧許可<select id="visibility-choice" value={nextVisibility} disabled={!canManage} onChange={event => setDraft(event.target.value as Visibility)}>{(Object.keys(visibilityLabels) as Visibility[]).map(value => <option key={value} value={value}>{visibilityLabels[value]}（{value}）</option>)}</select></label><button id="review-visibility" type="button" className="secondary" disabled={!canManage || nextVisibility === detail.visibility} onClick={() => setAction({ kind: 'visibility', id: detail.evaluation_id, from: detail.visibility, to: nextVisibility, wasLatest: detail.is_latest })}>変更内容を確認</button></div><div><h3>最新として指定</h3><p className="muted">登録完了・閲覧可の評価だけを指定できます。旧評価は閲覧可のまま履歴に残ります。</p><button id="review-latest" type="button" className="secondary" disabled={!canManage || detail.visibility !== 'VISIBLE' || detail.is_latest} onClick={() => setAction({ kind: 'latest', id: detail.evaluation_id, from: detail.visibility })}>最新の指定を確認</button></div></div>
        {!meetsManagementConditions && <p className="notice warning">登録状態・保存検査・権限を満たしていないため変更は保留です。</p>}
      </section>}
      {permission === 'admin' && detail && <EvaluationRecordDetail value={detail} />}
    </div>
    {action && <ActionConfirmation title={action.kind === 'visibility' ? '閲覧許可の変更を確認' : '最新の指定を確認'} pending={writing} onConfirm={() => void commit()} onCancel={() => setAction(null)}>
      <dl className="identity-list"><dt>対象の評価ID</dt><dd id="confirmation-evaluation-id"><code>{action.id}</code></dd><dt>操作</dt><dd>{action.kind === 'visibility' ? `閲覧許可 ${action.from} → ${action.to}` : 'この評価を最新として指定'}</dd><dt>操作権限</dt><dd>サーバー確認済みの管理者</dd></dl>
      <p className="notice warning">{action.kind === 'visibility' ? action.to === 'VISIBLE' ? 'この評価が閲覧者の履歴・詳細から見られるようになります。最新の指定は自動では変わりません。' : `この評価は閲覧者の履歴・詳細からも外れます。${action.wasLatest ? '最新の指定先でもあるため、最新画面が保留になる場合があります。' : ''}` : '最新の参照先だけを変更します。旧評価を自動で非公開・置換済みにする操作ではありません。'}</p><p className="muted">評価の数値・出典・モデルは編集しません。予測の有用性や実購入の承認ではありません。</p>
    </ActionConfirmation>}
  </>;
}
