import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseSavedRecordDetail, type SavedRaceRecord } from '@boatrace/contracts';
import ConnectionForm, { type ConnectionProps } from '../../shared/ui/ConnectionForm';
import { readEvaluationSession } from '../../shared/api/evaluations';
import { parseDatePage, parseVenuePage, parseRecordPage } from '../../shared/api/savedRaces';
import useSavedResource from './useSavedResource';
import type { RaceSelection } from './route';
import RaceAnalysis from './RaceAnalysis';
import ForecastWorkspace from '../forecast/ForecastWorkspace';

const isPredictionIndex = (record: SavedRaceRecord) => record.status === 'SAVED_PREDICTION_INDEX_ONLY' || record.holdReasons.includes('SAVED_PREDICTION_INDEX_ONLY');
const query = (values: Record<string, string>) => new URLSearchParams(values).toString();
function Status({ loading, error, empty, label }: { loading: boolean; error: string; empty?: boolean; label: string }) {
  if (loading) return <p role="status" className="operation-status">{label}を読み込んでいます…</p>;
  if (error) return <p role="alert" className="notice error">{error} 前の選択の数値は表示していません。</p>;
  if (empty) return <p className="empty-records">この条件の{label}は未保存です。</p>;
  return null;
}

export default function SavedRaceWorkspace({ selection, onSelect, ...connection }: ConnectionProps & { selection: RaceSelection; onSelect: (selection: RaceSelection) => void }) {
  const [connected, setConnected] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectedJob,setSelectedJob]=useState({raceKey:'', id:''});
  const [pending,setPending]=useState(false);
  const [selectionOpen,setSelectionOpen]=useState(!selection.race);
  useEffect(()=>setSelectionOpen(!selection.race),[selection.race]);
  const select=(next:RaceSelection)=>{if(!pending){
    if(next.date!==selection.date||next.venue!==selection.venue||next.race!==selection.race)setSelectedJob({raceKey:'',id:''});
    onSelect(next);
  }};

  const sequence = useRef(0);
  const { date, venue, race, record } = selection;
  const raceKey=JSON.stringify([date,venue,race]);
  const jobId=selectedJob.raceKey===raceKey?selectedJob.id:'';
  useEffect(()=>{if(connection.identity&&connection.token)setConnected(connection.token);},[connection.token,connection.identity]);
  const token = connected === connection.token ? connected.trim() : '';
  useEffect(() => () => { sequence.current++; }, []);
  const dates = useSavedResource('dates', token, parseDatePage, revision, true);
  const venues = useSavedResource(date ? `venues?${query({ date })}` : null, token, parseVenuePage, revision, true);
  const races = useSavedResource(date && venue ? `races?${query({ date, venue })}` : null, token, parseRecordPage, revision, true);
  const predictions = useSavedResource(race ? `predictions?${query({ raceId: race })}` : null, token, parseRecordPage, revision, true);
  const detail = useSavedResource(record ? `predictions/${encodeURIComponent(record)}` : null, token, parseSavedRecordDetail, revision);
  const selectedRace = races.data?.items.find(item => item.id === race)?.record;
  const detailMatches = detail.data?.record && detail.data.record.raceId === race && detail.data.record.date === date && detail.data.record.venueCode === venue;
  const composerRecord=record?detail.data?.record:selectedRace;
  const composerValid=!!composerRecord&&(!record||!!detailMatches&&!detail.loading&&!detail.error&&detail.data?.status==='AVAILABLE')&&composerRecord.holdReasons.length===0&&!/HELD|CANCEL|WITHDRAWN|FAILED/i.test(composerRecord.status??'');
  const selectedRaceMatches = selectedRace?.date === date && selectedRace.venueCode === venue;

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = ++sequence.current;
    setConnected(''); setConnecting(true); setConnectionError(''); connection.onIdentity?.(null);
    try {
      const identity = await readEvaluationSession(connection.token.trim());
      if (sequence.current !== request) return;
      connection.onIdentity?.(identity); setConnected(connection.token); setRevision(value => value + 1);
    } catch (error) {
      if (sequence.current === request) setConnectionError(error instanceof Error ? error.message : '権限を確認できません。');
    } finally { if (sequence.current === request) setConnecting(false); }
  }
  function changeToken(value: string) {
    sequence.current++; setConnected(''); setConnectionError(''); setConnecting(false); connection.onTokenChange(value);
  }
  return <>
    <ConnectionForm compact token={connection.token} onTokenChange={changeToken} onSubmit={connect} busy={connecting || pending} identity={connection.identity} button="保存レースを読む" />
    <p className="notice neutral">日付・競艇場・レースを選ぶと、保存時点の情報と、このレースの予想依頼を確認できます。新しい予想は実行ボタンを押したときに依頼します。</p>
    {connectionError && <p className="notice error" role="alert">{connectionError}</p>}
    {!token ? <section className="state-panel"><h2>保存時点の予想をたどる</h2><p>接続後、日付 → 競艇場 → レース → 保存履歴の順に選択します。</p></section> : <div id="saved-race-workspace">
      <details className="race-selection-disclosure" open={selectionOpen} onToggle={event=>{if(event.target===event.currentTarget)setSelectionOpen(event.currentTarget.open);}}><summary>対象レース：{date||'日付未選択'} / {selectedRace?.venueName??venue??'場未選択'} / {selectedRace?`${selectedRace.raceNumber}R`:'レース未選択'}（変更）</summary><section className="panel" aria-labelledby="race-selection-heading">
        <div className="section-title"><div><h2 id="race-selection-heading">レースを選ぶ</h2><p>条件を変えると、その先の選択と表示を解除します。</p></div><button className="secondary small" type="button" disabled={pending} onClick={() => {if(!pending)setRevision(value => value + 1);}}>保存記録を再読込</button></div>
        <label className="race-date-label" htmlFor="saved-race-date">1. 開催日<input id="saved-race-date" type="date" value={date} onChange={event => select({ date: event.target.value, venue: '', race: '', record: '' })} /></label>
        <Status {...dates} label="開催日" empty={dates.data?.items.length === 0} />
        <div className="selection-chips" aria-label="保存された開催日">{dates.data?.items.map(item => <button className="secondary" key={item.date} type="button" aria-pressed={date === item.date} onClick={() => select({ date: item.date, venue: '', race: '', record: '' })}>{item.date}</button>)}</div>
        {date && <div className="selection-step"><h3>2. 競艇場</h3><Status {...venues} label="競艇場" empty={venues.data?.items.length === 0} /><div className="selection-chips" aria-label="競艇場">{venues.data?.items.map(item => <button data-venue-code={item.venueCode} key={item.venueCode} className="secondary" aria-pressed={venue === item.venueCode} type="button" onClick={() => select({ date, venue: item.venueCode, race: '', record: '' })}>{item.venueName ?? `場コード ${item.venueCode}`} <small>{item.venueCode}</small></button>)}</div></div>}
        {venue && <div className="selection-step"><h3>3. レース</h3><Status {...races} label="レース" empty={races.data?.items.length === 0} /><div className="race-card-grid">{races.data?.items.map(item => <button data-race-id={item.id} key={item.id} type="button" className="secondary race-card" aria-pressed={race === item.id} disabled={!item.record} onClick={() => select({ date, venue, race: item.id, record: '' })}><strong>{item.record ? `${item.record.raceNumber}R` : '確認保留'}</strong><span>{item.record?.title ?? '名称未保存'}</span><small>{!item.record ? '保存整合異常' : isPredictionIndex(item.record) ? '保存予想から作成した索引・開催カタログ未保存' : `元保存: ${item.record.status ?? '状態未保存'}`}</small>{item.record && item.record.holdReasons.length > 0 && <small>追加確認保留（{item.record.holdReasons.length}件）</small>}</button>)}</div></div>}
      </section></details>
      {race && <section className="panel" aria-labelledby="saved-history-heading"><div className="section-title"><div><h2 id="saved-history-heading">保存時点のレース情報・予想</h2><p>{selectedRaceMatches ? `${selectedRace.venueName ?? venue} ${selectedRace.raceNumber}R` : race}</p></div><span className="tag">別の予想への自動置換なし</span></div>
        {selectedRaceMatches && <dl id="saved-race-catalog" className="detail-grid" data-record-id={selectedRace.id}><div><dt>検索用レースID</dt><dd>{selectedRace.raceId}</dd></div><div><dt>元保存のレースID</dt><dd>{selectedRace.sourceRaceId ?? '未保存'}</dd></div><div><dt>対象日</dt><dd>{selectedRace.date}</dd></div><div><dt>場コード</dt><dd>{selectedRace.venueCode}</dd></div><div><dt>レース番号</dt><dd>{selectedRace.raceNumber}</dd></div><div><dt>締切時刻</dt><dd>{selectedRace.cutoffAt ?? '未保存'}</dd></div><div><dt>{isPredictionIndex(selectedRace) ? '索引の状態' : '元保存の状態'}</dt><dd>{selectedRace.status ?? '未保存'}</dd></div>{isPredictionIndex(selectedRace) && <div><dt>索引の作成元</dt><dd>保存予想から作成した索引・開催カタログ未保存</dd></div>}</dl>}
        <Status {...predictions} label="予想記録" empty={predictions.data?.items.length === 0} />
        <div className="saved-history">{predictions.data?.items.map(item => <button key={item.id} data-prediction-id={item.id} type="button" className="secondary" aria-pressed={record === item.id} onClick={() => select({ date, venue, race, record: item.id })}><strong>{item.record?.model?.name ?? item.record?.model?.profile ?? 'モデル名未保存'}</strong><span>{item.record?.createdAt ?? '保存時刻未保存'}</span><small>{item.record?.timeMode ?? 'モード未保存'}</small>{item.record ? <><small>元保存: {item.record.status ?? '状態未保存'}</small>{item.record.holdReasons.length > 0 && <small>追加確認保留（{item.record.holdReasons.length}件）</small>}</> : <small>保存整合異常</small>}<code>{item.id}</code></button>)}</div>
      </section>}
      {selectedRaceMatches && <div className="race-analysis-workspace race-detail-layout"><div>
      {!record && <RaceAnalysis token={token} value={{id:selectedRace.id,status:'AVAILABLE',record:selectedRace,recordJsonUtf8:null,reasons:[]}} />}
      {record && <><Status {...detail} label="保存予想の詳細" />{detail.data && (!detail.data.record || detailMatches ? <RaceAnalysis token={token} value={detail.data} /> : <p role="alert" className="notice error">保存記録と選択したレースが一致しません。数値は表示していません。</p>)}</>}
      </div><section className="race-composer" aria-labelledby="race-jobs-heading"><h2 id="race-jobs-heading">{selectedRace.venueName ?? venue} {selectedRace.raceNumber}Rの予想依頼</h2><ForecastWorkspace key={raceKey} {...connection} onBusyChange={value=>{setPending(value);connection.onBusyChange(value);}} embedded requestContext={{valid:composerValid,cutoffAt:composerRecord?.cutoffAt??null,state:composerRecord?.status??null}} target={{date,venue,raceNumber:selectedRace.raceNumber}} jobId={jobId} onJob={id=>setSelectedJob({raceKey,id})}/></section></div>}
    </div>}
  </>;
}
