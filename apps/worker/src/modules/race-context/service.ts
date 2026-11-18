import {assertRaceContext,type RaceContext} from '../../../../../packages/contracts/src/race-context';
import {Problem,sha256,type ArtifactRepository} from '../evaluations/domain';
import type {ContextRepository} from '../../infrastructure/d1/race-context';
import type {SavedRaceRepository} from '../saved-races/domain';
import {SavedRaceService,savedId} from '../saved-races/service';
import {strictJson} from '../access/strict-json';
export class RaceContextService{
 constructor(private contexts:ContextRepository,private parents:SavedRaceRepository,private artifacts:ArtifactRepository){}
 private async parent(id:string,visible:boolean){
 const row=await this.parents.get(savedId(id));
 if(!row||row.state!=='REGISTERED'||visible&&row.visibility!=='VISIBLE')throw new Problem(404,'CONTEXT_PARENT_NOT_AVAILABLE');
 const detail=await new SavedRaceService(this.parents,this.artifacts).detail(id,undefined,true);
 if(!detail.record)throw new Problem(409,'CONTEXT_PARENT_INVALID');
 return {row,record:detail.record};
 }
 async read(id:string){
 const parent=await this.parent(id,true),row=await this.contexts.get(id);
 if(!row)throw new Problem(404,'RACE_CONTEXT_NOT_PROVIDED');
 const raw=await this.artifacts.get(row.artifact_key);
 if(!raw||raw.length!==row.byte_length||await sha256(raw)!==row.sha256)throw new Problem(503,'RACE_CONTEXT_TAMPERED');
 let context:RaceContext;try{context=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as RaceContext;assertRaceContext(context);}catch{throw new Problem(503,'INVALID_STORED_RACE_CONTEXT');}
 this.matches(context,parent);if(row.parent_sha256!==parent.row.sha256)throw new Problem(409,'CONTEXT_PARENT_CHANGED');
 const current=await this.parent(id,true);if(current.row.sha256!==parent.row.sha256)throw new Problem(409,'CONTEXT_PARENT_CHANGED');
 return {status:'AVAILABLE' as const,context};
 }
 private matches(v:RaceContext,p:Awaited<ReturnType<RaceContextService['parent']>>){
 if(v.recordId!==p.row.id||v.parentSha256!==p.row.sha256||v.raceId!==p.record.raceId||v.date!==p.record.date||v.venueCode!==p.record.venueCode||v.raceNumber!==p.record.raceNumber)throw new Problem(409,'CONTEXT_PARENT_MISMATCH');
 for(const e of v.entries){const parent=p.record.entries.find(x=>x.lane===e.lane);if(parent&&((parent.name!==null&&e.name!==parent.name)||(parent.registrationNumber!==null&&e.registrationNumber!==parent.registrationNumber)))throw new Problem(409,'CONTEXT_ROSTER_MISMATCH');}
 }
 async register(raw:Uint8Array){
 let v:RaceContext;try{v=strictJson(new TextDecoder('utf-8',{fatal:true}).decode(raw)) as RaceContext;assertRaceContext(v);}catch{throw new Problem(400,'INVALID_RACE_CONTEXT');}
 const parent=await this.parent(v.recordId,false);this.matches(v,parent);
 const hash=await sha256(raw),key='race-contexts/'+v.recordId+'/'+hash+'.json';
 const prior=await this.contexts.get(v.recordId);if(prior&&prior.sha256!==hash)throw new Problem(409,'RACE_CONTEXT_CONFLICT');
 await this.artifacts.stage(key,raw);const readback=await this.artifacts.get(key);if(!readback||await sha256(readback)!==hash)throw new Problem(503,'CONTEXT_STORAGE_FAILED');
 const current=await this.parent(v.recordId,false);if(current.row.sha256!==parent.row.sha256)throw new Problem(409,'CONTEXT_PARENT_CHANGED');
 await this.contexts.reserve({record_id:v.recordId,parent_sha256:v.parentSha256,sha256:hash,artifact_key:key,byte_length:raw.length});
 const committed=await this.contexts.get(v.recordId);if(committed?.sha256!==hash)throw new Problem(409,'RACE_CONTEXT_CONFLICT');
 return {id:v.recordId,status:'REGISTERED',sha256:hash,idempotent:!!prior};
 }
}
