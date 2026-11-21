import {useEffect,useState} from 'react';
import {parseRaceOutcome,type LivePrediction,type PredictionJob,type RaceOutcome} from '@boatrace/contracts';
import {requestValue} from './job-records';
import {PredictionServiceError} from './request-error';
import {forecastCodeLabel} from './forecast-presentation';

const percent=new Intl.NumberFormat('ja-JP',{style:'percent',maximumFractionDigits:2});

function position(result:LivePrediction|null|undefined, combination:string) {
 const index=result?.combinations.indexOf(combination)??-1;
 if(!result?.probabilities||index<0)return '比較対象なし';
 const probability=result.probabilities[index];
 return `${result.probabilities.filter(value=>value>probability).length+1}位（${percent.format(probability)}）`;
}

export function RaceOutcomePanel({job,baseline,token}:{job:PredictionJob;baseline?:PredictionJob|null;token:string}) {
 const {date,venueCode,raceNumber,mode}=job.request;
 const [state,setState]=useState<{status:'loading'|'error'|'unregistered'|'integrity-error'}|{status:'ready';value:RaceOutcome}>({status:'loading'});
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(()=>{setState({status:'error'});controller.abort();},15000);
  void requestValue(token,`/api/race-outcomes/${date}/${venueCode}/${raceNumber}`,controller.signal)
   .then(value=>{
    if(controller.signal.aborted)return;
    const envelope=value as {outcome?:unknown};
    if(envelope.outcome===null){setState({status:'unregistered'});return;}
    const outcome=parseRaceOutcome(envelope.outcome);
    if(outcome.date!==date||outcome.venueCode!==venueCode||outcome.raceNumber!==raceNumber)throw new Error('OUTCOME_RACE_MISMATCH');
    setState({status:'ready',value:outcome});
   }).catch(error=>{if(!controller.signal.aborted)setState({status:error instanceof PredictionServiceError&&error.code==='RACE_OUTCOME_INTEGRITY_ERROR'?'integrity-error':'error'});}).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);controller.abort();};
 },[token,date,venueCode,raceNumber]);
 const outcome=state.status==='ready'?state.value:null;
 const proposal=job.result?.ticketProposal;
 return <section aria-labelledby="forecast-official-outcome">
  <h3 id="forecast-official-outcome">確定結果との照合</h3>
  {state.status==='loading'&&<p role="status">保存済みの確定結果を確認しています。</p>}
  {state.status==='error'&&<p role="status">確定結果を照合できませんでした。</p>}
  {state.status==='integrity-error'&&<p role="status">保存された確定結果の整合性を確認できませんでした。</p>}
  {state.status==='unregistered'&&<p>確定結果は未登録です。</p>}
  {outcome?.status==='CANCELLED'&&<p>開催結果は中止として登録されています。</p>}
  {outcome?.status==='FINAL'&&(()=>{
   const combination=outcome.finish.slice(0,3).join('-');
   const isExhibition=mode==='R5_PRE_RACE';
   return <>
    <dl className="detail-grid">
     <div><dt>確定着順</dt><dd>{outcome.finish.map(lane=>lane+'号艇').join(' → ')}</dd></div>
     <div><dt>3連単の払戻（100円あたり）</dt><dd>{combination} · {outcome.payoutYen.toLocaleString('ja-JP')}円</dd></div>
     <div><dt>基礎予想での順位</dt><dd>{position(isExhibition?baseline?.result:job.result,combination)}</dd></div>
     {isExhibition&&<div><dt>展示後予想での順位</dt><dd>{position(job.result,combination)}</dd></div>}
     <div><dt>買い目候補との照合</dt><dd>{proposal&&job.result?.odds?
      proposal.candidates.some(candidate=>candidate.combination===combination)?'候補に一致':'候補に一致なし':'価格付き候補なし'}</dd></div>
     {proposal?.mainline_gate&&<div><dt>当時の判定理由</dt><dd>{forecastCodeLabel(proposal.mainline_gate.status)}</dd></div>}
    </dl>
    <details><summary>確定結果の保存情報</summary><p>保存時刻 <time dateTime={outcome.sourceSavedAt}>{outcome.sourceSavedAt}</time></p><p>原本SHA256 <code style={{overflowWrap:'anywhere'}}>{outcome.sourceSha256}</code></p></details>
   </>;
  })()}
 </section>;
}
