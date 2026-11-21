import {useEffect,useState} from 'react';
import {parseRaceCatalog,type RaceCatalog} from '@boatrace/contracts';
import {requestValue,venues} from './job-records';
import {formatJstTimestamp} from './daily-presentation';

export function RaceCatalogView({date,token,disabled,onRace}:{
 date:string;token:string;disabled:boolean;onRace:(venue:string,race:number)=>void;
}) {
 const [state,setState]=useState<{catalogs:RaceCatalog[];status:'loading'|'ready'|'error'}>({catalogs:[],status:'loading'});
 useEffect(()=>{
  const abort=new AbortController();
  const timer=setTimeout(()=>{setState({catalogs:[],status:'error'});abort.abort();},15000);
  void requestValue(token,'/api/race-catalog/'+encodeURIComponent(date),abort.signal).then(result=>{
   if(abort.signal.aborted)return;
   if(!result||!Array.isArray(result.catalogs))throw new Error('INVALID_CATALOG_RESPONSE');
   const catalogs=result.catalogs.map(parseRaceCatalog);
   if(catalogs.some((catalog:RaceCatalog)=>catalog.date!==date))throw new Error('CATALOG_DATE_MISMATCH');
   setState({catalogs,status:'ready'});
  }).catch(()=>{if(!abort.signal.aborted)setState({catalogs:[],status:'error'});}).finally(()=>clearTimeout(timer));
  return()=>{clearTimeout(timer);abort.abort();};
 },[date,token]);
 return <details className="selection-step">
  <summary>保存済み開催一覧</summary>
  <p>登録済みの開催だけを表示します。締切は保存時点の情報です。</p>
  {state.status==='loading'&&<p role="status">開催一覧を読み込んでいます。</p>}
  {state.status==='error'&&<p role="status">保存済み開催一覧を確認できませんでした。</p>}
  {state.status==='ready'&&state.catalogs.length===0&&<p>この日の開催一覧は未登録です。</p>}
  {state.catalogs.map(catalog=><details key={catalog.venueCode}>
   <summary>{venues[Number(catalog.venueCode)-1]} · {catalog.races.length}レース</summary>
   <p className="muted">保存時刻 {formatJstTimestamp(catalog.observedAt)}</p>
   <div className="table-scroll"><table>
    <thead><tr><th scope="col">レース</th><th scope="col">保存時の発売締切</th><th scope="col">操作</th></tr></thead>
    <tbody>{catalog.races.map(race=><tr key={race.raceNumber}>
     <th scope="row">{race.raceNumber}R</th>
     <td>{race.status==='CANCELLED'?'中止':race.cutoffAt?race.cutoffAt.slice(11,16)+' JST':'未確認'}</td>
     <td>{race.status!=='CANCELLED'&&<button type="button" className="secondary" disabled={disabled}
      aria-label={venues[Number(catalog.venueCode)-1]+' '+race.raceNumber+'Rを選ぶ'}
      onClick={()=>onRace(catalog.venueCode,race.raceNumber)}>選ぶ</button>}</td>
    </tr>)}</tbody>
   </table></div>
  </details>)}
 </details>;
}
