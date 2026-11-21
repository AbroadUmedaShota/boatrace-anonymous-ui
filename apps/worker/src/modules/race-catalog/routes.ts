import {Hono} from 'hono';
import {parseRaceCatalog,validPredictionRace,type RaceCatalog} from '@boatrace/contracts';
import type {Bindings} from '../../composition';
import {D1RaceCatalogs,type StoredCatalog} from '../../infrastructure/d1/race-catalog';
import type {LocalIdentity} from '../access/auth';
import {strictJson} from '../access/strict-json';
import {Problem,sha256} from '../evaluations/domain';

const digest=(payload:string)=>sha256(new TextEncoder().encode(payload));
export const raceCatalogRoutes=new Hono<{Bindings:Bindings;Variables:{identity:LocalIdentity}}>();

async function verify(row:StoredCatalog) {
 try{
  if(await digest(row.payload)!==row.sha256)throw new Error();
  const catalog=parseRaceCatalog(strictJson(row.payload));
  if(catalog.date!==row.date||catalog.venueCode!==row.venue_code||Date.parse(catalog.observedAt)!==row.observed_ms)throw new Error();
  return catalog;
 }catch{throw new Problem(409,'RACE_CATALOG_INTEGRITY_ERROR');}
}

raceCatalogRoutes.get('/api/race-catalog/:date',async c=>{
 if(!['viewer','admin'].includes(c.get('identity').role))throw new Problem(403,'FORBIDDEN_ROLE');
 const date=c.req.param('date');
 if(new URL(c.req.url).search||!validPredictionRace({date,venueCode:'01',raceNumber:1}))throw new Problem(400,'INVALID_RACE');
 const {results}=await new D1RaceCatalogs(c.env.DB).list(date);
 return c.json({catalogs:await Promise.all(results.map(verify))});
});

raceCatalogRoutes.post('/api/race-catalog/import',async c=>{
 if(c.get('identity').role!=='registrar'||c.env.LOCAL_ONLY!=='true')throw new Problem(403,'FORBIDDEN_ROLE');
 if(new URL(c.req.url).search)throw new Problem(400,'QUERY_NOT_ALLOWED');
 if(c.req.header('Content-Type')?.split(';')[0]!=='application/json')throw new Problem(415,'JSON_REQUIRED');
 const reader=c.req.raw.body?.getReader();
 if(!reader)throw new Problem(400,'BODY_REQUIRED');
 let size=0,body='';
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let catalog:RaceCatalog;
 try{
  while(true){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>8192){await reader.cancel();throw new Problem(413,'RACE_CATALOG_TOO_LARGE');}
   body+=decoder.decode(part.value,{stream:true});
  }
  catalog=parseRaceCatalog(strictJson(body+decoder.decode()));
 }catch(error){if(error instanceof Problem)throw error;throw new Problem(400,'INVALID_RACE_CATALOG');}
 const {date,venueCode,observedAt,sourceSha256,races}=catalog;
 const observedMs=Date.parse(observedAt);
 if(observedMs>Date.now())throw new Problem(400,'CATALOG_FUTURE_OBSERVATION');
 const payload=JSON.stringify({date,venueCode,observedAt:new Date(observedMs).toISOString(),sourceSha256,
   races:[...races].sort((a,b)=>a.raceNumber-b.raceNumber).map(({raceNumber,cutoffAt,status})=>({raceNumber,cutoffAt,status}))});
 const hash=await digest(payload),repo=new D1RaceCatalogs(c.env.DB);
 await repo.publish(date,venueCode,observedMs,payload,hash);
 const row=await repo.get(date,venueCode);
 if(!row)throw new Problem(503,'RACE_CATALOG_STORAGE_FAILED');
 const stored=await verify(row);
 if(row.sha256!==hash)throw new Problem(409,'RACE_CATALOG_NOT_CURRENT');
 return c.json({catalog:stored});
});
