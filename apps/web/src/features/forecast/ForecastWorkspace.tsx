import { useEffect, useRef, useState, type FormEvent } from 'react';
import { matchesSavedPredictionTarget, validPredictionRace, type PredictionJob, type PredictionMode, type PredictionUsage } from '@boatrace/contracts';
import ConnectionForm, { type ConnectionProps } from '../../shared/ui/ConnectionForm';
import { readEvaluationSession } from '../../shared/api/evaluations';
import { jstTargetDate, manualAcquisitionAllowed, predictionNeedsRecovery, predictionTerminalConfirmed, restoredRequestDraft } from './request-safety';
import { parseCapabilities, type Capabilities } from './capabilities';
import { PredictionServiceError } from './request-error';
import { executionLabel, jobsPath, modes, parseJob, parseJobList, requestValue, states, venues } from './job-records';
import {formatJstTimestamp,modeGuidance,parseDailyUsage} from './daily-presentation';
import {blocksNewLiveForecast,forecastCodeLabel,forecastReasonLabels,liveForecastMethod} from './forecast-presentation';
import { parseDatePage, parseRecordPage } from '../../shared/api/savedRaces';
import SavedForecastLinks, { savedRaceId } from '../races/SavedForecastLinks';
import useSavedResource from '../races/useSavedResource';

const anonymousOwnerTrial = (import.meta as ImportMeta & {env?:Record<string,string>}).env?.VITE_BOAT_RELEASE_PROFILE === 'ANONYMOUS_OWNER_TRIAL';

const modeOrder: PredictionMode[] = ['BASE_DAY_BEFORE', 'BASE_SAME_DAY', 'R5_PRE_RACE'];
type RaceHistory = {items: PredictionJob[]; requestableModes: PredictionMode[] | null};
type HistoryState = {token: string; path: string; data: RaceHistory | null; loading: boolean; error: string};
const emptyHistory: HistoryState = {token: '', path: '', data: null, loading: false, error: ''};
function Timestamp({value}:{value:unknown}){const text=formatJstTimestamp(value),raw=typeof value==='string'?value:undefined;return text==='未確認'?<span title={raw}>未確認</span>:<time dateTime={raw} title={raw}>{text}</time>;}
async function request(token:string,path:string,signal:AbortSignal,body?:unknown){return parseJob(await requestValue(token,path,signal,body));}
function sameRace(request: {date:string;venueCode:string;raceNumber:number}, target: {date:string;venueCode:string;raceNumber:number}) {
 return request.date===target.date&&request.venueCode===target.venueCode&&request.raceNumber===target.raceNumber;
}
function parseHistory(value: unknown, target: {date:string;venueCode:string;raceNumber:number}|null): RaceHistory {
 const data=value as {capabilities?:unknown;requestableModes?:PredictionMode[]};
 const items=parseJobList(value);
 if(!target)return {items,requestableModes:null};
 if(items.some(item=>!sameRace(item.request,target)))throw new Error('依頼一覧に対象外のレースが含まれています。');
 const capabilities=parseCapabilities(data.capabilities);
 const modes=data.requestableModes;
 if(!Array.isArray(modes)||new Set(modes).size!==modes.length||modes.some(mode=>!capabilities.canRequest||!capabilities.modes.includes(mode))) {
  throw new Error('レースの依頼条件を確認できません。');
 }
 return {items,requestableModes:modes};
}
function TicketProposal({value}:{value:Record<string,unknown>}) {
 const saved=(v:unknown)=>v===null||v===undefined?'未設定':typeof v==='object'?JSON.stringify(v):String(v);
 const code=(v:unknown)=>typeof v==='string'?forecastCodeLabel(v):saved(v);
 const candidates=Array.isArray(value.candidates)?value.candidates.filter((v):v is Record<string,unknown>=>!!v&&typeof v==='object'):[];
 const groups=value.groups&&typeof value.groups==='object'?value.groups as Record<string,Record<string,unknown>>:{};
 const gate=value.mainline_gate&&typeof value.mainline_gate==='object'?value.mainline_gate as Record<string,unknown>:null;
 return <section id="forecast-ticket-proposal"><h3>保存された分類・買い目セット</h3><p>セット状態：{code(value.state)}</p>{Array.isArray(value.reasons)&&<ul>{[...new Set(value.reasons)].map((v,i)=><li key={i}>{code(v)}</li>)}</ul>}<dl className="detail-grid"><div><dt>指定予算（円）</dt><dd>{value.budget_yen===null?'金額なし':saved(value.budget_yen)}</dd></div><div><dt>試行配分額（円）</dt><dd>{saved(value.cost_yen)}</dd></div><div><dt>本線判定</dt><dd>{code(gate?.status)}</dd></div><div><dt>本線収益率（保存値）</dt><dd>{saved(gate?.return_percent)}</dd></div><div><dt>本線収益比（保存値）</dt><dd>{saved(gate?.return_ratio)}</dd></div><div><dt>本線閾値（保存値）</dt><dd>{saved(gate?.threshold)}</dd></div></dl><p className="muted">分類はオッズに基づくもので、的中しやすさを示しません。表示金額は買い目作成用の参考情報です。</p><div className="table-scroll"><table><thead><tr><th>組合せ</th><th>分類</th><th>確率</th><th>保存されたオッズ</th><th>期待収益比</th><th>試行額（円）</th></tr></thead><tbody>{candidates.map((row,i)=><tr key={i}><td>{saved(row.combination)}</td><td>{saved(row.group_label)}</td><td>{saved(row.probability)}</td><td>{saved(row.odds)}</td><td>{saved(row.expected_return_ratio)}</td><td>{saved(row.stake_yen)}</td></tr>)}</tbody></table></div>{Object.keys(groups).length>0&&<div className="table-scroll"><table><caption>分類別の保存集計</caption><thead><tr><th>分類</th><th>件数</th><th>包含確率</th><th>期待収益比</th></tr></thead><tbody>{Object.entries(groups).map(([key,g])=><tr key={key}><td>{saved(g.group_label)}</td><td>{saved(g.count)}</td><td>{saved(g.coverage_probability)}</td><td>{saved(g.expected_return_ratio)}</td></tr>)}</tbody></table></div>}</section>;
}
export default function ForecastWorkspace(connection:ConnectionProps & {jobId:string;onJob:(id:string)=>void;target?:{date:string;venue:string;raceNumber:number};embedded?:boolean;requestContext?:{valid:boolean;cutoffAt:string|null;state:string|null}}) {
 const [budget,setBudget]=useState(''); const [date,setDate]=useState(connection.target?.date??jstTargetDate('R5_PRE_RACE')); const [venue,setVenue]=useState(connection.target?.venue??''); const [race,setRace]=useState(connection.target?.raceNumber??0); const [mode,setMode]=useState<PredictionMode>('R5_PRE_RACE');
 const [capability,setCapability]=useState<{token:string;value:Capabilities|null;error:string}>({token:'',value:null,error:''});
 const [lastSuccess,setLastSuccess]=useState<{token:string;job:PredictionJob}|null>(null);
 const [uncertain,setUncertain]=useState(false); const [viewingHistory,setViewingHistory]=useState(()=>!!connection.jobId); const [clock,setClock]=useState(Date.now());
 const [recent,setRecent]=useState<HistoryState>(emptyHistory);const [historyRevision,setHistoryRevision]=useState(0);
 const [usage,setUsage]=useState<{token:string;value:PredictionUsage|null;loading:boolean;error:string}>({token:'',value:null,loading:false,error:''});const [usageRevision,setUsageRevision]=useState(0);
 const [connected,setConnected]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [job,setJob]=useState<PredictionJob|null>(null); const [revision,setRevision]=useState(0);
 const generation=useRef(0); const pending=useRef(false); const key=useRef(''); const controller=useRef<AbortController|null>(null);
 const connecting=useRef<{token:string}|null>(null);
 const token=connected===connection.token?connected:'';
 const matchesTarget=(item:PredictionJob)=>!connection.target||(item.request.date===connection.target.date&&item.request.venueCode===connection.target.venue&&item.request.raceNumber===connection.target.raceNumber);
 const current=job?.id===connection.jobId&&token&&matchesTarget(job)?job:null;
 const inFlight=busy||!!current&&['QUEUED','RUNNING'].includes(current.state);
 const recoveryRequired=!!current&&predictionNeedsRecovery(current);
 const outcomeUnknown=uncertain||recoveryRequired;
 const locked=inFlight||outcomeUnknown||viewingHistory;
 useEffect(()=>{connection.onBusyChange(inFlight||outcomeUnknown);return()=>connection.onBusyChange(false);},[inFlight,outcomeUnknown]);
 useEffect(()=>{if(!current)return;if(predictionNeedsRecovery(current))setUncertain(true);else if(predictionTerminalConfirmed(current)){if(uncertain)setViewingHistory(true);setUncertain(false);}},[current,uncertain]);
 const capabilities=capability.token===token?capability.value:null;
 const liveRequestBlocked=blocksNewLiveForecast(anonymousOwnerTrial,capabilities?.executionMode);
 const usageDay=jstTargetDate('BASE_SAME_DAY',clock),dailyUsage=usage.token===token&&usage.value?.day===usageDay?usage.value:null;
 const target={date,venueCode:venue,raceNumber:race,mode};
 const targetValid=validPredictionRace(target)&&(!connection.target||sameRace(target,{date:connection.target.date,venueCode:connection.target.venue,raceNumber:connection.target.raceNumber}));
 const historyPath=targetValid?jobsPath+'/races/'+date+'/'+venue+'/'+race:jobsPath;
 const history=recent.token===token&&recent.path===historyPath?recent:null;
 const raceHistory=targetValid?history?.data:null;
 const savedDates = useSavedResource(connection.embedded ? null : 'dates?limit=8', token, parseDatePage, 0);
 const savedForecasts = useSavedResource(
  !connection.embedded && targetValid ? `predictions?raceId=${savedRaceId(date, venue, race)}` : null,
  token, parseRecordPage, historyRevision,
 );
 const restrictedReplay=anonymousOwnerTrial&&capabilities?.executionMode==='SAVED_REPLAY';
 const savedTargetAllowed=!restrictedReplay||matchesSavedPredictionTarget(capabilities.savedTargets,target);
 const contextAllowed=capabilities?.executionMode==='SAVED_REPLAY'?(!connection.embedded||!!connection.requestContext?.valid):manualAcquisitionAllowed(capabilities,{date,mode},connection.requestContext,!!connection.embedded,clock);
 useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const update=()=>{const now=Date.now();setClock(now);const cutoff=Date.parse(connection.requestContext?.cutoffAt??'');const midnight=Date.parse(jstTargetDate('BASE_SAME_DAY',now)+'T00:00:00+09:00')+86400000;const deadline=Number.isFinite(cutoff)&&cutoff>now?Math.min(cutoff,midnight):midnight;timer=setTimeout(update,Math.max(1,Math.min(deadline-now+1,2147483647)));};update();return()=>clearTimeout(timer);},[connection.requestContext?.cutoffAt]);
 function canPrepare(candidate:PredictionMode) {
  if(!targetValid||!capabilities?.canRequest||liveRequestBlocked||!raceHistory?.requestableModes?.includes(candidate))return false;
  const request={...target,mode:candidate};
  if(capabilities.executionMode==='SAVED_REPLAY')return (!connection.embedded||!!connection.requestContext?.valid)&&
    (!restrictedReplay||matchesSavedPredictionTarget(capabilities.savedTargets,request));
  return manualAcquisitionAllowed(capabilities,request,connection.requestContext,!!connection.embedded,clock);
 }
 const requestAllowed=canPrepare(mode);
 useEffect(()=>{if(!token){setCapability({token:'',value:null,error:''});setLastSuccess(null);return;}const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),15000);setCapability({token,value:null,error:''});
  void requestValue(token,'/api/prediction-jobs/capabilities',abort.signal).then(value=>{const parsed=parseCapabilities(value);if(!abort.signal.aborted)setCapability({token,value:parsed,error:''});}).catch(e=>{if(e instanceof Error&&e.name==='AuthenticationRequired'){setConnected('');setJob(null);setLastSuccess(null);if(key.current||connection.jobId)setUncertain(true);}setCapability({token,value:null,error:abort.signal.aborted?'実行条件の確認が時間内に完了しませんでした。':e instanceof Error?e.message:'実行条件を確認できません。'});}).finally(()=>clearTimeout(timer));return()=>{abort.abort();clearTimeout(timer);};
 },[token,historyRevision]);
 useEffect(()=>{if(!token){setUsage({token:'',value:null,loading:false,error:''});return;}const abort=new AbortController();const timeout=setTimeout(()=>{abort.abort();setUsage({token,value:null,loading:false,error:'利用枠を確認できません。確認が時間内に完了しませんでした。'});},15000);setUsage({token,value:null,loading:true,error:''});
  void requestValue(token,'/api/prediction-jobs/usage',abort.signal).then(value=>{const parsed=parseDailyUsage(value,usageDay);if(!abort.signal.aborted)setUsage({token,value:parsed,loading:false,error:''});}).catch(error=>{if(abort.signal.aborted)return;if(error instanceof Error&&error.name==='AuthenticationRequired'){setConnected('');setJob(null);setLastSuccess(null);if(key.current||connection.jobId)setUncertain(true);}setUsage({token,value:null,loading:false,error:'利用枠を確認できません。接続と認証を確認し、再読込してください。'});}).finally(()=>clearTimeout(timeout));return()=>{abort.abort();clearTimeout(timeout);};
 },[token,historyRevision,usageRevision,usageDay]);
 useEffect(()=>{if(current?.state==='COMPLETED'&&current.result?.status==='AVAILABLE'&&Number.isFinite(Date.parse(current.createdAt)))setLastSuccess(previous=>previous?.token===token&&Date.parse(previous.job.createdAt)>Date.parse(current.createdAt)?previous:{token,job:current});},[current,token]);
 useEffect(()=>{
  setLastSuccess(null);
  if(!token||targetValid||!history?.data)return;
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),15000);
  // The API limits the list to 50 summaries; only details prove an AVAILABLE result.
  const candidates=history.data.items.filter(item=>item.state==='COMPLETED'&&Number.isFinite(Date.parse(item.createdAt))).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  void (async()=>{for(const item of candidates){const value=await request(token,`/api/prediction-jobs/${encodeURIComponent(item.id)}`,abort.signal);if(abort.signal.aborted)return;if(value.state==='COMPLETED'&&value.result?.status==='AVAILABLE'&&Number.isFinite(Date.parse(value.result.generatedAt))){setLastSuccess({token,job:value});return;}}})().catch(e=>{if(!abort.signal.aborted){setLastSuccess(null);if(e instanceof Error&&e.name==='AuthenticationRequired'){setConnected('');setJob(null);setError(e.message);}}}).finally(()=>clearTimeout(timer));
  return()=>{abort.abort();clearTimeout(timer);};
 },[token,targetValid,history]);
 useEffect(()=>{
  if(!token){setRecent(emptyHistory);return;}
  const abort=new AbortController();
  const scope=targetValid?{date,venueCode:venue,raceNumber:race}:null;
  const timeout=setTimeout(()=>{
   abort.abort();
   setRecent({token,path:historyPath,data:null,loading:false,error:'依頼一覧の読み込みが時間内に完了しませんでした。'});
  },15000);
  setRecent({token,path:historyPath,data:null,loading:true,error:''});
  void requestValue(token,historyPath,abort.signal).then(value=>{
   const data=parseHistory(value,scope);
   if(!abort.signal.aborted)setRecent({token,path:historyPath,data,loading:false,error:''});
  }).catch(error=>{
   if(abort.signal.aborted)return;
   if(error instanceof Error&&error.name==='AuthenticationRequired'){
    setConnected('');setJob(null);setLastSuccess(null);
    if(key.current||connection.jobId)setUncertain(true);
   }
   setRecent({token,path:historyPath,data:null,loading:false,error:error instanceof Error?error.message:'依頼一覧を読めません。'});
  }).finally(()=>clearTimeout(timeout));
  return()=>{abort.abort();clearTimeout(timeout);};
 },[token,historyPath,historyRevision,date,venue,race,targetValid]);
 const terminalJobId=current&&predictionTerminalConfirmed(current)?current.id:null;
 useEffect(()=>{if(terminalJobId)setHistoryRevision(value=>value+1);},[terminalJobId]);
 useEffect(()=>{if(connection.identity&&connection.token)setConnected(connection.token);},[connection.token,connection.identity]);
 function reset(){if(inFlight||outcomeUnknown)return;setViewingHistory(false); generation.current++;controller.current?.abort();key.current='';setUncertain(false);setJob(null);setError('');connection.onJob(''); }
 useEffect(()=>()=>{connecting.current=null;generation.current++;controller.current?.abort();},[]);
 useEffect(()=>{if(!token||!connection.jobId){setJob(null);return;}const sequence=++generation.current;const abort=new AbortController();setJob(null);setError('');let timer:ReturnType<typeof setTimeout>;
  async function read(){try{const value=await request(token,`/api/prediction-jobs/${encodeURIComponent(connection.jobId)}`,abort.signal);if(sequence!==generation.current||abort.signal.aborted)return;if(value.id!==connection.jobId)throw new Error('取得した予想依頼と指定したIDが一致しません。');const draft=restoredRequestDraft(key.current,value.request,connection.target);if(draft){key.current=draft.key;setDate(draft.date);setVenue(draft.venue);setRace(draft.race);setMode(draft.mode);setBudget(draft.budget);setViewingHistory(true);}setJob(value);if(['QUEUED','RUNNING'].includes(value.state))timer=setTimeout(read,3000);}catch(e){if(!abort.signal.aborted&&sequence===generation.current){setJob(null);setUncertain(true);if(e instanceof Error&&e.name==='AuthenticationRequired'){setConnected('');setLastSuccess(null);}setError((e instanceof Error?e.message:'依頼を読めません。')+' 処理状態は未確認です。状態を再読込するまで新しい依頼はできません。');}}}void read();return()=>{abort.abort();clearTimeout(timer);};
 },[token,connection.jobId,revision]);
 async function connect(event:FormEvent){event.preventDefault();if(connecting.current||pending.current||inFlight||(outcomeUnknown&&!!token))return;const attempt={token:connection.token};connecting.current=attempt;setBusy(true);setError('');try{const identity=await readEvaluationSession(attempt.token);if(connecting.current===attempt){connection.onIdentity?.(identity);setConnected(attempt.token);}}catch(e){if(connecting.current===attempt){setConnected('');setJob(null);setError(e instanceof Error?e.message:'接続できません。');}}finally{if(connecting.current===attempt){connecting.current=null;setBusy(false);}}}
 async function submit(){if(connecting.current||pending.current||!token||!requestAllowed||locked)return;if(capabilities?.executionMode==='LIVE'&&!manualAcquisitionAllowed(capabilities,{date,mode},connection.requestContext,!!connection.embedded)){setClock(Date.now());setError('対象日・必要な実行条件を確認できないため、新しい予想は依頼できません。');return;}const text=budget.trim();const amount=text===''?undefined:Number(text);if(amount!==undefined&&(!/^\d+$/.test(text)||!Number.isSafeInteger(amount)||amount<=0||amount%100!==0)){setJob(null);setError('予算は空欄、または正の100円単位で入力してください。安全な整数の範囲を超える金額は指定できません。');return;}pending.current=true;setBusy(true);setError('');setJob(null);controller.current?.abort();const abort=new AbortController();controller.current=abort;const sequence=++generation.current;const timeout=setTimeout(()=>abort.abort(),20000);key.current ||= crypto.randomUUID();
  try{const value=await request(token,'/api/prediction-jobs',abort.signal,{date,venueCode:venue,raceNumber:race,mode,idempotencyKey:key.current,...(amount===undefined?{}:{budgetYen:amount})});if(sequence===generation.current){setUncertain(false);setJob(value);connection.onJob(value.id);setRevision(v=>v+1);setHistoryRevision(v=>v+1);}}catch(e){if(sequence===generation.current){if(e instanceof Error&&e.name==='AuthenticationRequired'){setConnected('');setLastSuccess(null);}if(e instanceof PredictionServiceError&&e.notAccepted){setUncertain(false);setViewingHistory(false);key.current='';connection.onJob('');setError(e.message);}else{setUncertain(true);setError((e instanceof TypeError?'通信結果を確認できません。':e instanceof Error&&e.name!=='AbortError'?e.message:'送信結果が未確認です。')+' 自動再送はしません。履歴を再読込し、受付済みか確認してください。同じ条件での再操作には同じ依頼キーを使用します。');}}}finally{clearTimeout(timeout);pending.current=false;if(sequence===generation.current)setBusy(false);}}
 useEffect(()=>{
  if(token&&connection.jobId)document.getElementById('forecast-job-heading')?.focus();
 },[token,connection.jobId]);
 function returnToSelection() {
  if(!current||inFlight||outcomeUnknown)return;
  reset();
  document.getElementById('forecast-target-heading')?.focus();
 }
 function historyLocked(item: PredictionJob) {
  return inFlight||outcomeUnknown&&item.request.idempotencyKey!==key.current;
 }
 function openHistory(item: PredictionJob) {
  if(historyLocked(item))return;
  setViewingHistory(true);
  generation.current++;
  controller.current?.abort();
  setJob(null);
  setError('');
  setDate(item.request.date);
  setVenue(item.request.venueCode);
  setRace(item.request.raceNumber);
  setMode(item.request.mode);
  setBudget(item.request.budgetYen==null?'':String(item.request.budgetYen));
  key.current=item.request.idempotencyKey;
  connection.onJob(item.id);
  setRevision(value=>value+1);
 }
 return <div className={connection.embedded?"embedded-forecast":"forecast-full"}>
  {!(connection.embedded&&connection.identity)&&<ConnectionForm token={connection.token} onTokenChange={value=>{if(inFlight||(outcomeUnknown&&!!token))return;connecting.current=null;generation.current++;controller.current?.abort();setJob(null);setError('');setConnected('');setBusy(false);connection.onTokenChange(value);}} onSubmit={connect} busy={inFlight||(outcomeUnknown&&!!token)} identity={connection.identity} button="予想サービスへ接続" />}
 {!token&&<p className="notice neutral">予想サービスへ接続すると、レース選択と予想履歴を利用できます。</p>}
 {recoveryRequired&&<p role="alert" className="notice error">処理状態が未確定です。管理者による復旧後に「状態を再読込」してください。取得・計算を自動再実行しません。</p>}
 {error&&<p role="alert" className="notice error">{error} 前の数値は表示していません。</p>}
 {token&&<>
 {connection.jobId&&<section className="panel" id="forecast-job" aria-live="polite"><h2 id="forecast-job-heading" tabIndex={-1}>予想リクエストの状況</h2>{viewingHistory&&<p className="muted">保存された依頼の履歴を閲覧しています。</p>}<p>依頼ID：<code>{connection.jobId}</code></p><button type="button" className="secondary" onClick={()=>setRevision(v=>v+1)}>状態を再読込</button><button id="forecast-new-request" type="button" className="secondary" disabled={inFlight||outcomeUnknown||!current} onClick={returnToSelection}>{connection.embedded?'このレースの予想を選ぶ':'レース選択に戻る'}</button>{targetValid&&<button type="button" className="secondary" onClick={()=>document.getElementById('forecast-history-heading')?.focus()}>このレースの履歴を見る</button>}{!current&&!error&&<p role="status">読込中…</p>}{current&&<><h3 data-job-state={current.state}>{states[current.state]}</h3><p>{current.request.date} / 場コード {current.request.venueCode} / {current.request.raceNumber}R / {modes[current.request.mode]}</p><p>{executionLabel(current)}</p><p>買い目作成用の予算：{current.request.budgetYen===null||current.request.budgetYen===undefined?'金額なし':`${current.request.budgetYen}円`}</p><p>受付：<Timestamp value={current.createdAt}/> / 更新：<Timestamp value={current.updatedAt}/></p><ul>{forecastReasonLabels(current.reasons).map((reason,i)=><li key={i}>{reason}</li>)}</ul></>}</section>}
 {current?.state==='COMPLETED'&&current.result?.status==='AVAILABLE'&&<section className="panel" id="forecast-result"><h2>予想結果</h2><p className="notice warning">{current.result.executionMode==='SAVED_REPLAY'?'保存データでの動作確認です。当日の新しい予想ではありません。':'依頼時に取得した情報で計算した結果です。取得・締切時刻を確認してください。画面を開いても再取得しません。的中や利益を保証するものではありません。'}</p><p className="forecast-result-target">{current.request.date} / {venues[Number(current.request.venueCode)-1]} {current.request.raceNumber}R / {modes[current.request.mode]}</p><p className="muted">選手・展示・気象の比較情報は、この予想結果の契約では未提供です。保存された確率・オッズ・買い目を表示します。</p><details className="forecast-provenance"><summary>モデル・取得時点・照合情報</summary><p className="muted">日時は日本標準時（JST）で表示しています。原文の時刻は各日時の補足情報とデータの詳細（JSON）で確認できます。</p><dl className="detail-grid"><div><dt>計算時刻</dt><dd><Timestamp value={current.result.generatedAt}/></dd></div><div><dt>モデル作成時刻</dt><dd><Timestamp value={current.result.modelCreatedAt}/></dd></div><div><dt>モデルSHA256</dt><dd>{current.result.modelSha256??'未確認'}</dd></div><div><dt>取得時刻</dt><dd><Timestamp value={current.result.observedAt}/></dd></div><div><dt>オッズの時点（保存値）</dt><dd><Timestamp value={current.result.oddsObservedAt}/></dd></div><div><dt>モデル利用可能時刻</dt><dd><Timestamp value={current.result.modelAvailableAt}/></dd></div><div><dt>判断時刻</dt><dd><Timestamp value={current.result.decisionAt}/></dd></div><div><dt>締切時刻</dt><dd><Timestamp value={current.result.cutoffAt}/></dd></div></dl></details><ul>{forecastReasonLabels(current.result.reasons).map((reason,i)=><li key={i}>{reason}</li>)}</ul><div className="table-scroll probability-scroll"><table><caption>予想の詳細（確率0〜1）。保存された順序と数値を表示しています。</caption><thead><tr><th>組合せ</th><th>確率</th><th>保存されたオッズ</th></tr></thead><tbody>{current.result.combinations.map((combination,i)=><tr key={combination}><td>{combination}</td><td className="saved-probability">{current.result!.probabilities?.[i]??'未取得'}</td><td>{current.result!.odds?.[i]??'未取得'}</td></tr>)}</tbody></table></div>{current.result.ticketProposal?<TicketProposal value={current.result.ticketProposal}/>:<p>分類・買い目セット：未生成・未保存</p>}<details><summary>データの詳細（JSON）</summary><pre className="forecast-proposal">{JSON.stringify(current.result,null,2)}</pre></details></section>}
 <section className="panel forecast-target-panel" aria-labelledby="forecast-target-heading"><h2 id="forecast-target-heading" tabIndex={-1}>{connection.embedded?'このレースの予想':'日付・競艇場・レースを選ぶ'}</h2>
 {restrictedReplay&&!savedTargetAllowed&&<p className="notice neutral" role="status">{capabilities.savedTargets.length===0
  ? '依頼できる保存入力を確認できません。'
  : connection.embedded
   ? '「レースを選ぶ」を開き、登録済みの保存入力を選んでください。'
   : '依頼できるのは登録済みの保存入力だけです。下の一覧から対象を選んでください。'}</p>}
 {capabilities?.executionMode==='SAVED_REPLAY'&&!connection.embedded&&capabilities.savedTargets.length>0&&<div className="saved-target-preparation"><h3>保存入力から対象を準備</h3><p>対象を入力するだけです。計算は下の実行ボタンで依頼します。</p><div className="selection-chips">{capabilities.savedTargets.map(target=><button type="button" className="secondary" key={target.mode} data-saved-target={target.mode} disabled={locked} onClick={()=>{if(locked)return;reset();setDate(target.date);setVenue(target.venueCode);setRace(target.raceNumber);setMode(target.mode);requestAnimationFrame(()=>document.getElementById('forecast-race-status-heading')?.focus());}}>{modes[target.mode]} / {target.date} / {venues[Number(target.venueCode)-1]} {target.raceNumber}R</button>)}</div></div>}
 {!connection.embedded&&<><label className="race-date-label">開催日<input id="forecast-date" type="date" value={date} disabled={locked} onChange={e=>{reset();setDate(e.target.value);setVenue('');setRace(0);}} /></label>{!connection.embedded&&<div className="selection-chips date-shortcuts">{(['BASE_SAME_DAY','BASE_DAY_BEFORE'] as const).map((m,i)=><button type="button" className="secondary small" key={m} disabled={locked} onClick={()=>{if(locked)return;reset();setDate(jstTargetDate(m));setVenue('');setRace(0);}}>{i===0?'今日':'翌日'}（JST）</button>)}</div>}
 {savedDates.data && savedDates.data.items.length > 0 && <div className="selection-step">
  <h3>予想やレース情報が保存された日付</h3>
  <div className="selection-chips">{savedDates.data.items.map(({ date: savedDate }) =>
   <button type="button" key={savedDate} className="secondary small" disabled={locked} aria-pressed={date === savedDate}
    onClick={() => { reset(); setDate(savedDate); setVenue(''); setRace(0); }}>{savedDate}</button>
  )}</div>
  {!locked && <a href="#races">保存レースを日付・場・レース番号から探す</a>}
 </div>}
 {date&&<div className="selection-step"><h3>競艇場</h3><div className="selection-chips">{venues.map((name,index)=>{const code=String(index+1).padStart(2,'0');return <button type="button" className="secondary" key={code} data-forecast-venue={code} disabled={locked} aria-pressed={venue===code} onClick={()=>{reset();setVenue(code);setRace(0);}}>{name} <small>{code}</small></button>;})}</div></div>}
 {venue&&<div className="selection-step"><h3>レース番号</h3><div className="race-card-grid">{Array.from({length:12},(_,i)=>i+1).map(n=><button type="button" className="secondary" key={n} disabled={locked} data-forecast-race={n} aria-pressed={race===n} onClick={()=>{reset();setRace(n);requestAnimationFrame(()=>document.getElementById('forecast-race-status-heading')?.focus());}}>{n}R</button>)}</div></div>}
 </>}
 {targetValid&&<section id="forecast-race-status" aria-labelledby="forecast-race-status-heading">
  <h3 id="forecast-race-status-heading" tabIndex={-1}>{date} / {venues[Number(venue)-1]} {race}R</h3>
  {!connection.embedded&&<p className="muted">開催情報未確認。依頼時に開催・出走・締切を確認します。</p>}
  {!connection.embedded && <SavedForecastLinks date={date} venue={venue} raceNumber={race}
   records={savedForecasts.data?.items ?? []} loading={savedForecasts.loading} error={savedForecasts.error}
   locked={inFlight || outcomeUnknown} />}
  {!connection.jobId&&<button type="button" className="secondary small" onClick={()=>document.getElementById('forecast-history-heading')?.focus()}>このレースの履歴を見る</button>}
  {!history?.data&&!history?.error&&<p role="status">このレースの依頼状況を確認中…</p>}
  {history?.error&&<p role="alert">このレースの依頼状況を確認できません。依頼一覧を再読込してください。</p>}
  {raceHistory&&<><ul>{modeOrder.map(candidate=>{
   const latest=raceHistory.items.find(item=>item.request.mode===candidate);
   const canSelect=canPrepare(candidate);
   return <li key={candidate} data-race-mode-status={candidate}>
    <div className="forecast-race-mode-summary">
     <strong>{modes[candidate]}</strong>
     <span>{latest?predictionNeedsRecovery(latest)?'処理状態が未確定':states[latest.state]:'最近の依頼なし'}</span>
     {latest&&<small>{executionLabel(latest)} / <Timestamp value={latest.createdAt}/></small>}
     <small>{canSelect?'依頼条件を確認済み':capabilities?'現在の条件では依頼できません':capability.error?'依頼条件を確認できません':'依頼条件を確認中'}</small>
    </div>
    {(latest||canSelect)&&<div className="forecast-race-mode-actions">
     {latest&&<button type="button" className="secondary small" disabled={historyLocked(latest)} onClick={()=>openHistory(latest)}>直近の依頼を開く</button>}
     {canSelect&&<button type="button" className="secondary small" data-prepare-race-mode={candidate} disabled={inFlight||outcomeUnknown} onClick={()=>{reset();setMode(candidate);requestAnimationFrame(()=>document.getElementById('forecast-mode')?.focus());}}>この方式で準備</button>}
    </div>}
   </li>;
  })}</ul><p className="muted">受付時に利用枠や待機時間を確認します。予想履歴はこのレースの直近50件です。</p></>}
 </section>}
 {!targetValid&&!connection.embedded&&<p className="muted">レース番号を選ぶと、予想の方式と履歴を確認できます。</p>}
 {targetValid&&<>
 {capabilities&&!contextAllowed&&!liveRequestBlocked&&<p role="alert" className="notice error">この対象は依頼できません。対象日、取得許可、保留・締切の状態を確認してください。</p>}
 <label className="forecast-mode">予想の種類<select id="forecast-mode" value={mode} disabled={locked} onChange={e=>{reset();setMode(e.target.value as PredictionMode);}}>{Object.entries(modes).map(([value,label])=>{const unavailable=!!capabilities&&!capabilities.modes.includes(value as PredictionMode);return <option key={value} value={value} disabled={unavailable}>{label}{unavailable?'（対象外）':''}</option>;})}</select><small>{capabilities?.executionMode==='SAVED_REPLAY'?'保存入力と同じ対象日・方式を指定してください。現在日の情報には置き換えません。':'当日・直前は今日、前日予想は翌日のレースを対象にします（JST）。方式を変えても対象日を自動変更しません。'}</small></label>
 <label className="forecast-mode" htmlFor="forecast-budget">買い目作成用の予算（円・任意）<input id="forecast-budget" type="text" inputMode="numeric" autoComplete="off" value={budget} disabled={locked} onChange={e=>{reset();setBudget(e.target.value);}} aria-describedby="forecast-budget-help" /><small id="forecast-budget-help">空欄は金額なし。指定する場合は正の100円単位。購入の許可や自動増額は行いません。</small></label>
 <aside id="forecast-mode-guidance" className="notice neutral" aria-labelledby="forecast-mode-guidance-heading"><h3 id="forecast-mode-guidance-heading">この方式を使うタイミング</h3><p>{modeGuidance[mode].required}</p><p>{modeGuidance[mode].timing}</p>{capabilities?.executionMode==='SAVED_REPLAY'&&<p>方式を選ぶときの目安です。この設定では保存入力を再生します。</p>}{mode==='BASE_DAY_BEFORE'&&<p><a href="https://www.boatrace.jp/owpc/pc/extra/about.html" target="_blank" rel="noopener noreferrer">公式の情報更新案内</a></p>}</aside>
 <button id="forecast-submit" type="button" disabled={locked||!date||!venue||!race||!requestAllowed} onClick={()=>void submit()}>{busy?'受付を確認しています…':liveRequestBlocked?'新しい予想の受付停止中':capabilities?.executionMode==='SAVED_REPLAY'?'保存データで動作確認する':!connection.embedded&&capabilities?.canAcquireOnRequest?'情報を取得して予想する':'予想する'}</button><p className="muted">受付時に共有利用枠と待機時間を確認します。</p></>}
 </section>
 <section className="panel" id="forecast-history"><h2 id="forecast-history-heading" tabIndex={-1}>{targetValid?'このレースの予想履歴':'最近の予想履歴'}</h2><p className="muted">最大50件。画面を閉じた後や送信結果が未確認のときは、再読込して受付済みの依頼を選んでください。閲覧操作で予想を作り直しません。</p><button type="button" className="secondary" onClick={()=>setHistoryRevision(v=>v+1)}>履歴を再読込</button>{(!history||history.loading)&&<p role="status">依頼一覧を読込中…</p>}{history?.error&&<p role="alert">{history.error}</p>}{history?.data?.items.filter(matchesTarget).length===0&&<p>表示対象の予想依頼はありません。</p>}<div className="saved-history">{history?.data?.items.filter(matchesTarget).map(item=><button type="button" className="secondary" key={item.id} data-job-history-id={item.id} disabled={historyLocked(item)} aria-pressed={connection.jobId===item.id} onClick={()=>openHistory(item)}><strong>{item.request.date} / {venues[Number(item.request.venueCode)-1]} {item.request.raceNumber}R</strong><span>{modes[item.request.mode]} / {states[item.state]}</span><span>{executionLabel(item)}</span><span>受付：<Timestamp value={item.createdAt}/></span><span>買い目作成用の予算：{item.request.budgetYen===null||item.request.budgetYen===undefined?'金額なし':`${item.request.budgetYen}円`}</span><span>{forecastReasonLabels(item.reasons).join(' / ')}</span><code>{item.id}</code></button>)}</div></section>
<section className="panel" id="forecast-capabilities"><h2>予想サービスの受付条件</h2>{capabilities?<><p data-execution-mode={capabilities.executionMode}>{capabilities.executionMode==='LIVE'?liveForecastMethod:'保存データでの動作確認（当日の新しい予想ではありません）'}</p>{liveRequestBlocked?<p role="alert">この合成データの接続試験では、新しい情報取得を伴う予想依頼は受け付けません。保存済みの依頼は閲覧できます。</p>:<><p>{capabilities.canRequest?'予想依頼が可能です。':'閲覧専用です。予想依頼の権限はありません。'}</p>{capabilities.executionMode==='LIVE'&&!capabilities.acquisitionApproved&&<p role="alert">依頼に伴う情報取得の許可が未確認のため、依頼できません。</p>}</>}<p className="muted">共有上限：1日{capabilities.limits.jobsPerJstDay}依頼・{capabilities.limits.httpPerJstDay} HTTP要求（JST）。取得間隔{capabilities.limits.minHttpIntervalSeconds}秒以上、同じ対象の再依頼は{capabilities.limits.sameTargetCooldownSeconds}秒以上。</p></>:capability.error?<p role="alert">{capability.error} 実行条件が確認できるまで依頼できません。「履歴を再読込」で再確認してください。</p>:<p role="status">実行条件を確認中…</p>}</section>

 <section className="panel" id="forecast-usage" aria-labelledby="forecast-usage-heading"><h2 id="forecast-usage-heading">今日の共有利用枠</h2><button type="button" className="secondary small" disabled={usage.token===token&&usage.loading} onClick={()=>setUsageRevision(value=>value+1)}>利用枠を再読込</button>{usage.token===token&&usage.loading?<p role="status">利用枠を確認中…</p>:dailyUsage?<><p>{dailyUsage.day}（JST）の共有台帳 / 確認：<Timestamp value={dailyUsage.asOf}/></p><dl className="detail-grid"><div><dt>予想依頼</dt><dd>使用 {dailyUsage.jobs.used} / 上限 {dailyUsage.jobs.limit} 件・残り <strong data-usage-remaining="jobs">{dailyUsage.jobs.remaining}</strong> 件</dd></div><div><dt>外部HTTP要求</dt><dd>使用 {dailyUsage.http.used} / 上限 {dailyUsage.http.limit} 件・残り <strong data-usage-remaining="http">{dailyUsage.http.remaining}</strong> 件</dd></div></dl>{dailyUsage.recoveryRequired&&<p role="alert" className="notice error">未確定の処理が残っています。管理者による復旧で状態を確定するまで、新しい依頼は受け付けません。</p>}<p className="muted">確認時点の値です。残り枠があっても受付は保証されません。サーバーが依頼時に上限・待機時間・未確定処理を確認します。再読込は台帳の確認だけで、情報取得や計算は行いません。</p></>:<p role="alert">{usage.token===token&&usage.error?usage.error:'利用枠を確認できません。再読込してください。'}</p>}</section>
 {!targetValid&&lastSuccess?.token===token&&<section className="panel" id="forecast-last-success"><h2>最近50件で最新受付の成功確認</h2><p>{executionLabel(lastSuccess.job)} / {lastSuccess.job.request.date} / {venues[Number(lastSuccess.job.request.venueCode)-1]} {lastSuccess.job.request.raceNumber}R / {modes[lastSuccess.job.request.mode]}</p><p>生成時刻：<Timestamp value={lastSuccess.job.result!.generatedAt}/></p><p className="muted">履歴の詳細を確認した結果です。生成時刻の最新順ではありません。現在選択中の依頼の成功を示すものではありません。失敗・保留時に以前の結果を新しい結果として表示しません。</p></section>}
 </>}
 </div>;
}
