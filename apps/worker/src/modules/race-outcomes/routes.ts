import {Hono} from 'hono';
import {parseRaceOutcome,validPredictionRace} from '@boatrace/contracts';
import type {Bindings} from '../../composition';
import {D1RaceOutcomes,type StoredOutcome} from '../../infrastructure/d1/race-outcomes';
import type {LocalIdentity} from '../access/auth';
import {strictJson} from '../access/strict-json';
import {Problem,sha256} from '../evaluations/domain';

const contentHash=(payload:string)=>sha256(new TextEncoder().encode(payload));
export const raceOutcomeRoutes=new Hono<{Bindings:Bindings;Variables:{identity:LocalIdentity}}>();

async function checked(row:StoredOutcome,date:string,venue:string,race:number) {
 try {
  if(await contentHash(row.payload)!==row.sha256)throw new Error();
  const outcome=parseRaceOutcome(strictJson(row.payload));
  if(outcome.date!==date||outcome.venueCode!==venue||outcome.raceNumber!==race)throw new Error();
  return outcome;
 }catch{throw new Problem(409,'RACE_OUTCOME_INTEGRITY_ERROR');}
}

raceOutcomeRoutes.get('/api/race-outcomes/:date/:venue/:race',async c=>{
 if(!['viewer','admin'].includes(c.get('identity').role))throw new Problem(403,'FORBIDDEN_ROLE');
 const {date,venue,race}=c.req.param();
 if(new URL(c.req.url).search || !/^(?:[1-9]|1[0-2])$/.test(race) ||
    !validPredictionRace({date,venueCode:venue,raceNumber:Number(race)}))throw new Problem(400,'INVALID_RACE');
 const row=await new D1RaceOutcomes(c.env.DB).get(date,venue,Number(race));
 return c.json({outcome:row?await checked(row,date,venue,Number(race)):null});
});

raceOutcomeRoutes.post('/api/race-outcomes/import',async c=>{
 if(c.get('identity').role!=='registrar'||c.env.LOCAL_ONLY!=='true')throw new Problem(403,'FORBIDDEN_ROLE');
 if(new URL(c.req.url).search)throw new Problem(400,'QUERY_NOT_ALLOWED');
 if(c.req.header('Content-Type')?.split(';')[0]!=='application/json')throw new Problem(415,'JSON_REQUIRED');
 const reader=c.req.raw.body?.getReader();
 if(!reader)throw new Problem(400,'BODY_REQUIRED');
 const decoder=new TextDecoder('utf-8',{fatal:true});let size=0,body='';
 try{
  while(true){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>4096){await reader.cancel();throw new Problem(413,'RACE_OUTCOME_TOO_LARGE');}
   body+=decoder.decode(part.value,{stream:true});
  }
  body+=decoder.decode();
 }catch(error){if(error instanceof Problem)throw error;throw new Problem(400,'INVALID_RACE_OUTCOME');}
 let record;
 try{record=parseRaceOutcome(strictJson(body));}catch{throw new Problem(400,'INVALID_RACE_OUTCOME');}
 const {date,venueCode,raceNumber,status,sourceSha256,sourceSavedAt}=record;
 const payload=JSON.stringify({date,venueCode,raceNumber,status,sourceSha256,sourceSavedAt,
   ...(status==='FINAL'?{finish:record.finish,payoutYen:record.payoutYen}:{})});
 const hash=await contentHash(payload), repo=new D1RaceOutcomes(c.env.DB);
 await repo.reserve(date,venueCode,raceNumber,payload,hash);
 const row=await repo.get(date,venueCode,raceNumber);
 if(!row)throw new Problem(503,'RACE_OUTCOME_STORAGE_FAILED');
 const outcome=await checked(row,date,venueCode,raceNumber);
 if(row.sha256!==hash)throw new Problem(409,'RACE_OUTCOME_CONFLICT');
 return c.json({outcome});
});
