import {currentManualTarget} from './manual-target';
import {assertPredictionRequest,assertLivePrediction,assertPredictionUsage,type PredictionUsage,type PredictionJob,type PredictionRequest,type PredictionTarget} from '@boatrace/contracts';
import type {PredictionJobRepository,Row,ComputeArtifactRepository} from './domain';
import {strictJson} from '../access/strict-json';
import {Problem,sha256} from '../evaluations/domain';
function configuredPin(value:string|undefined,mode:string){if(value?.startsWith('{')){try{return JSON.parse(value)[mode] as string|undefined;}catch{return undefined;}}return value;}
export class PredictionJobs {
 constructor(private repo:PredictionJobRepository,private dispatch?:Fetcher,private inputId?:string,private bucket?:ComputeArtifactRepository,private inputSha?:string,private modelSha?:string,private asynchronous=false,private executionMode:'SAVED_REPLAY'|'LIVE'='SAVED_REPLAY',private sourcePins:Record<string,{key:string;sha256:string}>={},private dataAcquisitionApproved=false,private requireRecoveryBeforeReservation=false,private requireCurrentManualTarget=false,private admission?:(request:PredictionRequest,owner:string)=>void){}
 private async project(row:Row,summary=false):Promise<PredictionJob> {let result=null;let artifactInvalid=false;if(row.result&&!summary){try{const ref=JSON.parse(row.result);const bytes=await this.bucket?.get(ref.key);if(!bytes||await sha256(bytes)!==ref.sha256)throw new Error();const parsed=strictJson(new TextDecoder().decode(bytes));assertLivePrediction(parsed,row.id);if(parsed.status==='AVAILABLE')await this.verifySources(row.id,parsed.sourceRefs,parsed.odds!==null);result=parsed;}catch{artifactInvalid=true;}}const expired=(row.state==='RUNNING'&&row.lease_until!==null&&row.lease_until<new Date().toISOString()||row.state==='QUEUED'&&row.created_at<new Date(Date.now()-300000).toISOString());return {recoveryRequired:expired,schemaVersion:'boatrace-prediction-job/1',id:row.id,executionMode:row.execution_mode,state:expired||artifactInvalid?'HELD':row.state,request:JSON.parse(row.request),createdAt:row.created_at,updatedAt:row.updated_at,reasons:artifactInvalid?['RESULT_ARTIFACT_INVALID']:expired?['EXECUTION_OUTCOME_UNKNOWN']:JSON.parse(row.reasons),result:expired||artifactInvalid?null:result};}
 async detail(id:string){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new Problem(400,'INVALID_JOB_ID');const row=await this.repo.statement('get').bind(id).first<Row>();if(!row)throw new Problem(404,'JOB_NOT_FOUND');return this.project(row);}
 async list(){const rows=await this.repo.statement('list').all<Row>();return Promise.all(rows.results.map(row=>this.project(row,true)));}
 async listForRace({date, venueCode, raceNumber}: Omit<PredictionTarget, 'mode'>) {
  const {results} = await this.repo.statement('listForRace').bind(date, venueCode, raceNumber).all<Row>();
  return Promise.all(results.map(row => this.project(row, true)));
 }
 async usage(at=new Date()):Promise<PredictionUsage>{
 const asOf=at.toISOString(),day=new Date(at.getTime()+32400000).toISOString().slice(0,10),cutoff=new Date(at.getTime()-300000).toISOString();
 const row=await this.repo.statement('usage').bind(day,day,day,day,asOf,cutoff).first<{own_jobs:number;legacy_jobs:number;own_http:number;legacy_http:number;recovery_required:number}>();
 if(!row||![row.own_jobs,row.legacy_jobs,row.own_http,row.legacy_http].every(x=>Number.isSafeInteger(x)&&x>=0)||![0,1].includes(row.recovery_required))throw new Problem(503,'PREDICTION_USAGE_UNAVAILABLE');
 const jobs=row.own_jobs+row.legacy_jobs,http=row.own_http+row.legacy_http;
 const value:PredictionUsage={schemaVersion:'boatrace-prediction-usage/1',day,asOf,jobs:{used:jobs,limit:6,remaining:Math.max(0,6-jobs)},http:{used:http,limit:24,remaining:Math.max(0,24-http)},recoveryRequired:row.recovery_required===1};
 try{assertPredictionUsage(value);}catch{throw new Problem(503,'PREDICTION_USAGE_UNAVAILABLE');}return value;
 }
 async create(value:unknown,owner:string){try{assertPredictionRequest(value);}catch{throw new Problem(400,'INVALID_PREDICTION_REQUEST');}const req=value as PredictionRequest;
 const raw=JSON.stringify({date:req.date,venueCode:req.venueCode,raceNumber:req.raceNumber,mode:req.mode,idempotencyKey:req.idempotencyKey,...('budgetYen'in req?{budgetYen:req.budgetYen}:{})}),hash=await sha256(new TextEncoder().encode(raw));
 const old=await this.repo.statement('byOwnerKey').bind(owner,req.idempotencyKey).first<Row>();if(old){if(old.hash!==hash)throw new Problem(409,'IDEMPOTENCY_CONFLICT');return this.project(old);}
 this.admission?.(req,owner);
 if(this.requireCurrentManualTarget&&this.executionMode==='LIVE'&&!currentManualTarget(req))throw new Problem(400,'TARGET_DATE_MODE_MISMATCH');
 const now=new Date().toISOString(),id='job-'+crypto.randomUUID(),day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 const cutoff=new Date(Date.now()-300000).toISOString();
 const inserted=await this.repo.statement(this.requireRecoveryBeforeReservation?'reserveGuarded':'reserve').bind(id,owner,req.idempotencyKey,raw,hash,now,now,this.executionMode,configuredPin(this.inputSha,req.mode)??null,configuredPin(this.modelSha,req.mode)??null,day,req.date,req.venueCode,req.raceNumber,cutoff,...(this.requireRecoveryBeforeReservation?[now,cutoff]:[])).run();
 if(!inserted.meta.changes){const duplicate=await this.repo.statement('byOwnerKey').bind(owner,req.idempotencyKey).first<Row>();if(duplicate){if(duplicate.hash!==hash)throw new Problem(409,'IDEMPOTENCY_CONFLICT');return this.project(duplicate);}if(this.requireRecoveryBeforeReservation&&await this.repo.statement('expiredUnresolved').bind(now,cutoff).first<Row>())throw new Problem(409,'RECOVERY_REQUIRED');throw new Problem(429,'SHARED_QUOTA_OR_COOLDOWN');}
 if(this.executionMode==='LIVE'&&!this.dataAcquisitionApproved){await this.finish(id,'HELD',['DATA_ACQUISITION_NOT_APPROVED']);return this.detail(id);}
 if(!this.dispatch||!this.inputId){await this.finish(id,'HELD',['DISPATCH_NOT_CONFIGURED']);return this.detail(id);}return this.execute(id);
 }
 async finish(id:string,state:'HELD'|'FAILED',reasons:string[]){await this.repo.statement('finish').bind(state,JSON.stringify(reasons),new Date().toISOString(),id).run();}
 private async verifySources(id:string,refs:string[],hasOdds=false){
  if(!this.bucket)throw new Problem(503,'SOURCE_STORAGE_UNAVAILABLE');const job=await this.repo.statement('get').bind(id).first<Row>();if(!job)throw new Problem(404,'JOB_NOT_FOUND');
  const rows=(await this.repo.statement('jobArtifacts').bind(id).all<{kind:string;key:string;sha256:string}>()).results;
  if(job.execution_mode==='LIVE'){const required=['source-racelist',...(JSON.parse(job.request).mode==='R5_PRE_RACE'?['source-beforeinfo']:[]),...(hasOdds?['source-odds3t']:[])];for(const kind of required)if(!rows.some(row=>row.kind===kind&&refs.includes(row.sha256)))throw new Problem(409,'LIVE_SOURCE_PAGE_MISSING');}
  for(const row of rows)if(row.kind.startsWith('source-')&&!refs.includes(row.sha256))throw new Problem(409,'SOURCE_REFERENCE_MISSING');
  for(const ref of refs){const row=rows.find(x=>x.sha256===ref);if(!row)throw new Problem(409,'SOURCE_REFERENCE_UNREGISTERED');const raw=await this.bucket.read(row.key,ref===job.expected_model_sha256?'model':'source');if(!raw||await sha256(raw)!==ref)throw new Problem(409,'SOURCE_REFERENCE_TAMPERED');}
 }
 async getPinned(group:string,id:string){if(!['models','inputs'].includes(group)||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Problem(400,'INVALID_COMPUTE_ARTIFACT_ID');const pin=this.sourcePins[group+'/'+id];if(!pin)throw new Problem(404,'COMPUTE_ARTIFACT_NOT_FOUND');const raw=await this.bucket?.read(pin.key,group==='models'?'model':'input');if(!raw||await sha256(raw)!==pin.sha256)throw new Problem(503,'COMPUTE_ARTIFACT_TAMPERED');return {raw,sha256:pin.sha256};}
 async reserveAcquisition(id:string,value:{targetDay:string;venueCode:string;raceNumber:number}){const result=await this.repo.statement('reserveAcquisition').bind(id,new Date().toISOString(),this.dataAcquisitionApproved?1:0,value.targetDay,value.venueCode,value.raceNumber).run();if(!result.meta.changes)throw new Problem(409,'ACQUISITION_CONTEXT_OR_GRANT_INVALID');return {reserved:true,jobId:id};}
 async complete(id:string,value:unknown){try{assertLivePrediction(value,id);}catch{throw new Problem(400,'INVALID_LIVE_PREDICTION');}
 const row=await this.repo.statement('get').bind(id).first<Row>();if(!row)throw new Problem(404,'JOB_NOT_FOUND');
 const raw=JSON.stringify(value),bytes=new TextEncoder().encode(raw),hash=await sha256(bytes);
 if(row.result){const previous=JSON.parse(row.result);if(previous.sha256!==hash)throw new Problem(409,'RESULT_CONFLICT');return this.detail(id);}
 if(row.state!=='RUNNING'||!row.lease_until||row.lease_until<new Date().toISOString())throw new Problem(409,'JOB_NOT_RUNNING');
 const input=await this.repo.statement('inputHash').bind(id).first<{sha256:string}>();const mode=JSON.parse(row.request).mode;const expectedInput=row.execution_mode==='SAVED_REPLAY'?row.expected_input_sha256:input?.sha256;const expectedModel=row.expected_model_sha256;
 if(value.executionMode!==row.execution_mode)throw new Problem(409,'EXECUTION_MODE_MISMATCH');
 if(!this.bucket||value.requestSha256!==row.hash||value.status==='AVAILABLE'&&(!expectedInput||value.inputSha256!==expectedInput||!expectedModel||value.modelSha256!==expectedModel))throw new Problem(409,'COMPUTE_PROVENANCE_MISMATCH');
 if(value.status==='AVAILABLE'){
  if(!expectedInput||!expectedModel||!value.sourceRefs.includes(expectedInput)||!value.sourceRefs.includes(expectedModel))throw new Problem(409,'SOURCE_REFERENCE_MISSING');
  for(const pin of Object.values(this.sourcePins)){if(value.sourceRefs.includes(pin.sha256)){const raw=await this.bucket.read(pin.key,pin.sha256===expectedModel?'model':'input');if(!raw||await sha256(raw)!==pin.sha256)throw new Problem(409,'PINNED_SOURCE_TAMPERED');await this.repo.statement('reserveArtifact').bind(id,'pin-'+pin.sha256,pin.sha256,pin.key,raw.length).run();}}
  await this.verifySources(id,value.sourceRefs,value.odds!==null);
 }
 const key='prediction-results/'+id+'/'+hash+'.json';await this.bucket.stage(key,bytes);
 const object=await this.bucket.get(key);if(!object||await sha256(object)!==hash)throw new Problem(503,'RESULT_STORAGE_FAILED');
 const update=await this.repo.statement('attachResult').bind(value.status==='HELD'?'HELD':'COMPLETED',JSON.stringify({key,sha256:hash}),JSON.stringify(value.reasons),new Date().toISOString(),id,new Date().toISOString()).run();if(!update.meta.changes){const current=await this.repo.statement('get').bind(id).first<Row>();if(!current?.result||JSON.parse(current.result).sha256!==hash)throw new Problem(409,'RESULT_COMMIT_CONFLICT');}return this.detail(id);
 }
 async artifact(id:string,kind:string,raw:Uint8Array){const job=await this.detail(id);if(job.state!=='RUNNING')throw new Problem(409,'JOB_NOT_RUNNING');if(job.executionMode!=='LIVE'||!this.dataAcquisitionApproved)throw new Problem(409,'LIVE_ARTIFACT_GRANT_REQUIRED');if(!this.bucket||!raw.length||raw.length>1048576)throw new Problem(413,'INVALID_ARTIFACT_SIZE');const hash=await sha256(raw),key='compute-captures/'+id+'/'+kind+'/'+hash;
 const prior=await this.repo.statement('artifactHash').bind(id,kind).first<{sha256:string}>();if(prior){if(prior.sha256!==hash)throw new Problem(409,'COMPUTE_ARTIFACT_CONFLICT');return {sha256:hash,bytes:raw.length};}
 await this.bucket.stage(key,raw);await this.repo.statement('reserveArtifact').bind(id,kind,hash,key,raw.length).run();const saved=await this.repo.statement('artifactHash').bind(id,kind).first<{sha256:string}>();if(saved?.sha256!==hash)throw new Problem(409,'COMPUTE_ARTIFACT_CONFLICT');return {sha256:hash,bytes:raw.length};}
 async recover(){const now=new Date().toISOString();const result=await this.repo.statement('recoverExpired').bind(now,now,new Date(Date.now()-300000).toISOString()).run();return {recovered:result.meta.changes};}
 async fetchPermit(id:string,requestId:string){if(!/^[A-Za-z0-9_-]{1,100}$/.test(requestId))throw new Problem(400,'INVALID_FETCH_REQUEST_ID');const job=await this.detail(id);if(job.state!=='RUNNING')throw new Problem(409,'JOB_NOT_RUNNING');if(job.executionMode!=='LIVE'||!this.dataAcquisitionApproved)throw new Problem(409,'LIVE_ACQUISITION_GRANT_REQUIRED');const key=id+'-'+requestId,now=new Date().toISOString();const day=new Date(Date.now()+32400000).toISOString().slice(0,10);
 const result=await this.repo.statement('reserveFetch').bind(key,id,now,day,new Date(Date.now()-3000).toISOString(),id,now,this.dataAcquisitionApproved?1:0).run();if(!result.meta.changes)throw new Problem(429,'FETCH_ALREADY_RESERVED_OR_SHARED_QUOTA');return {permitId:key,reservedAt:now,reusable:false};}
 async claim(id:string){const job=await this.detail(id);if(job.state!=='QUEUED')throw new Problem(409,'JOB_NOT_QUEUED');try{const changed=await this.repo.statement('claim').bind(new Date(Date.now()+300000).toISOString(),new Date().toISOString(),id).run();if(!changed.meta.changes)throw new Problem(409,'JOB_NOT_QUEUED');}catch(error){if(error instanceof Problem)throw error;throw new Problem(409,'COMPUTE_BUSY');}return this.detail(id);}
 async execute(id:string){const job=await this.detail(id);if(job.state!=='QUEUED')throw new Problem(409,'JOB_NOT_QUEUED');if(!this.dispatch||!this.inputId)throw new Problem(503,'DISPATCH_NOT_CONFIGURED');
 if(!this.asynchronous)await this.claim(id);
 try{const response=await this.dispatch.fetch('https://prediction-compute.invalid/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:id,request:job.request,executionMode:(await this.repo.statement('get').bind(id).first<Row>())!.execution_mode,inputId:configuredPin(this.inputId,job.request.mode)}),signal:AbortSignal.timeout(300000)});if(response.status===202)return this.detail(id);if(!response.ok)throw new Error('COMPUTE_FAILED');const raw=await response.text();if(raw.length>262144)throw new Error('COMPUTE_RESULT_TOO_LARGE');return await this.complete(id,strictJson(raw));}catch{if(this.asynchronous)await this.repo.statement('dispatchUnknown').bind(new Date().toISOString(),id).run();else await this.finish(id,'HELD',['EXECUTION_OUTCOME_UNKNOWN']);return this.detail(id);}
 }
}
