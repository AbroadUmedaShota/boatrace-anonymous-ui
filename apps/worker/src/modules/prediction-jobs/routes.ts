import {cloudOwnerAvailable,cloudOwnerRequired,cloudQueueTransport,configuredCloudOwnerPolicy,configuredSavedTargets} from './cloud-owner-policy';
import {matchesSavedPredictionTarget,validPredictionRace,type PredictionMode} from '@boatrace/contracts';
import {Hono} from 'hono';
import {predictionAcceptanceEnabled} from './acceptance';
import {currentManualTarget} from './manual-target';
import type {Bindings} from '../../composition';
import type {LocalIdentity} from '../access/auth';
import {Problem} from '../evaluations/domain';
import {strictJson} from '../access/strict-json';
import {composePredictionJobs as service} from '../../composition';
export const predictionJobRoutes=new Hono<{Bindings:Bindings;Variables:{identity:LocalIdentity}}>();
predictionJobRoutes.use('*',async(c,next)=>{if(new URL(c.req.url).search)throw new Problem(400,'QUERY_NOT_ALLOWED');await next();});

function read(identity:LocalIdentity){if(!['viewer','admin'].includes(identity.role))throw new Problem(403,'FORBIDDEN_ROLE');}
function canRequest(identity:LocalIdentity,env:Bindings){let allowed:unknown;try{allowed=JSON.parse(env.JOB_REQUESTER_SUBJECTS_JSON??'[]');}catch{}return identity.role==='admin'||Array.isArray(allowed)&&allowed.length<=50&&allowed.every(x=>typeof x==='string'&&/^[^\s]{1,256}$/.test(x))&&allowed.includes(identity.sub);}
const predictionModes: readonly PredictionMode[] = ['R5_PRE_RACE', 'BASE_SAME_DAY', 'BASE_DAY_BEFORE'];
function predictionCapabilities(identity: LocalIdentity, env: Bindings) {
 const executionMode=env.JOB_EXECUTION_MODE==='LIVE'?'LIVE' as const:'SAVED_REPLAY' as const;
 const unsupportedLive=env.JOB_TRANSPORT==='CLOUDFLARE_PYTHON_DO'&&executionMode==='LIVE';
 const cloud=cloudOwnerRequired(env),policy=cloud?cloudOwnerAvailable(env,identity.sub):null;
 const modelPins=(policy??configuredCloudOwnerPolicy(env))?.modelSha256;
 const modes=cloud?predictionModes.filter(mode=>modelPins?.[mode]):predictionModes;
 const savedTargets=configuredSavedTargets(env).filter(target=>modes.includes(target.mode));
 const requester=canRequest(identity,env);
 const localLive=env.LOCAL_ONLY==='true'&&env.AUTH_MODE==='LOCAL_HS256'&&env.JOB_TARGET_WORKFLOW==='ACQUIRE_ON_REQUEST'&&
  !!env.PREDICTION_DISPATCH&&!!env.JOB_INPUT_ID&&executionMode==='LIVE'&&env.DATA_ACQUISITION_APPROVED==='true'&&predictionAcceptanceEnabled(env);
 return {
  executionMode,
  acquisitionApproved:env.DATA_ACQUISITION_APPROVED==='true',
  canRequest:!unsupportedLive&&predictionAcceptanceEnabled(env)&&requester&&(!cloud||!!policy)&&
   (policy?.profile!=='ANONYMOUS_OWNER_TRIAL'||savedTargets.length>0),
  modes,
  canAcquireOnRequest:!unsupportedLive&&requester&&(policy?.profile==='LIVE_OWNER_TRIAL'||localLive),
  savedTargets,
  limits:{jobsPerJstDay:6,httpPerJstDay:24,minHttpIntervalSeconds:3,sameTargetCooldownSeconds:300}
 };
}
predictionJobRoutes.get('/api/prediction-jobs/capabilities',c=>{
 const identity=c.get('identity');
 read(identity);
 return c.json(predictionCapabilities(identity,c.env));
});
predictionJobRoutes.get('/api/prediction-jobs/races/:date/:venue/:raceNumber', async c => {
 const identity = c.get('identity');
 read(identity);
 const {date, venue, raceNumber} = c.req.param();
 const target = {date, venueCode: venue, raceNumber: Number(raceNumber)};
 if (!/^(?:[1-9]|1[0-2])$/.test(raceNumber) || !validPredictionRace(target)) {
  throw new Problem(400, 'INVALID_PREDICTION_RACE');
 }
 const capabilities = predictionCapabilities(identity, c.env);
 const now = Date.now();
 const matchingModes = capabilities.modes.filter(mode => {
  if (!capabilities.canRequest) return false;
  if (capabilities.executionMode === 'LIVE') {
   return capabilities.acquisitionApproved &&
    (c.env.JOB_TARGET_WORKFLOW !== 'ACQUIRE_ON_REQUEST' || currentManualTarget({date, mode}, now));
  }
  return !cloudOwnerRequired(c.env) ||
   matchesSavedPredictionTarget(capabilities.savedTargets, {...target, mode});
 });
 const items = await service(c.env).listForRace(target);
 return c.json({items, capabilities, requestableModes: matchingModes});
});
async function body(request:Request){if(request.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw new Problem(415,'JSON_REQUIRED');const bytes=await artifactBytes(request);if(bytes.length>262144)throw new Problem(413,'BODY_TOO_LARGE');const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(raw.length>262144)throw new Problem(413,'BODY_TOO_LARGE');try{return strictJson(raw);}catch{throw new Problem(400,'INVALID_BODY');}}
predictionJobRoutes.get('/api/prediction-jobs',async c=>{read(c.get('identity'));if(new URL(c.req.url).search)throw new Problem(400,'QUERY_NOT_ALLOWED');return c.json({items:await service(c.env).list()});});
predictionJobRoutes.get('/api/prediction-jobs/usage',async c=>{read(c.get('identity'));return c.json(await service(c.env).usage());});
predictionJobRoutes.get('/api/prediction-jobs/:id',async c=>{read(c.get('identity'));if(new URL(c.req.url).search)throw new Problem(400,'QUERY_NOT_ALLOWED');return c.json({job:await service(c.env).detail(c.req.param('id'))});});
predictionJobRoutes.post('/api/prediction-jobs',async c=>{const identity=c.get('identity');read(identity);let allowed:string[]=[];try{const parsed:unknown=JSON.parse(c.env.JOB_REQUESTER_SUBJECTS_JSON??'[]');if(Array.isArray(parsed)&&parsed.length<=50&&parsed.every(x=>typeof x==='string'&&/^[^\s]{1,256}$/.test(x)))allowed=parsed;}catch{}if(identity.role!=='admin'&&!allowed.includes(identity.sub))throw new Problem(403,'PREDICTION_REQUEST_NOT_ALLOWED');return c.json({job:await service(c.env).create(await body(c.req.raw),identity.sub)});});
predictionJobRoutes.post('/api/prediction-jobs/:id/execute',async c=>{if(c.get('identity').role!=='admin')throw new Problem(403,'FORBIDDEN_ROLE');if(cloudQueueTransport(c.env))throw new Problem(409,'QUEUE_REDISPATCH_NOT_ALLOWED');return c.json({job:await service(c.env).execute(c.req.param('id'))});});
predictionJobRoutes.post('/api/internal/prediction-jobs/:id/result',async c=>{if(c.get('identity').role!=='compute'||!c.env.JOB_SERVICE_SUBJECT||c.get('identity').sub!==c.env.JOB_SERVICE_SUBJECT)throw new Problem(403,'COMPUTE_SERVICE_REQUIRED');return c.json({job:await service(c.env).complete(c.req.param('id'),await body(c.req.raw))});});

predictionJobRoutes.post('/api/internal/prediction-jobs/:id/claim',async c=>{if(c.get('identity').role!=='compute'||!c.env.JOB_SERVICE_SUBJECT||c.get('identity').sub!==c.env.JOB_SERVICE_SUBJECT)throw new Problem(403,'COMPUTE_SERVICE_REQUIRED');return c.json({job:await service(c.env).claim(c.req.param('id'))});});

predictionJobRoutes.post('/api/admin/prediction-jobs/recover',async c=>{if(c.get('identity').role!=='admin')throw new Problem(403,'FORBIDDEN_ROLE');return c.json(await service(c.env).recover());});
predictionJobRoutes.post('/api/internal/prediction-jobs/:id/fetch-permits',async c=>{if(c.get('identity').role!=='compute'||!c.env.JOB_SERVICE_SUBJECT||c.get('identity').sub!==c.env.JOB_SERVICE_SUBJECT)throw new Problem(403,'COMPUTE_SERVICE_REQUIRED');const value=await body(c.req.raw) as {requestId:string};if(!value||Object.keys(value).join()!=='requestId')throw new Problem(400,'INVALID_BODY');return c.json(await service(c.env).fetchPermit(c.req.param('id'),value.requestId));});

function compute(identity:LocalIdentity,env:Bindings){if(identity.role!=='compute'||!env.JOB_SERVICE_SUBJECT||identity.sub!==env.JOB_SERVICE_SUBJECT)throw new Problem(403,'COMPUTE_SERVICE_REQUIRED');}
async function artifactBytes(request:Request){const reader=request.body?.getReader();if(!reader)throw new Problem(400,'BODY_REQUIRED');let count=0;const chunks=[];while(true){const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>1048576){await reader.cancel();throw new Problem(413,'ARTIFACT_TOO_LARGE');}chunks.push(part.value);}const raw=new Uint8Array(count);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}return raw;}
predictionJobRoutes.post('/api/internal/prediction-jobs/:id/input-artifact',async c=>{compute(c.get('identity'),c.env);return c.json(await service(c.env).artifact(c.req.param('id'),'input',await artifactBytes(c.req.raw)));});
predictionJobRoutes.post('/api/internal/prediction-jobs/:id/source-artifacts/:page',async c=>{compute(c.get('identity'),c.env);const page=c.req.param('page');if(!['racelist','beforeinfo','odds3t'].includes(page))throw new Problem(400,'INVALID_PAGE');return c.json(await service(c.env).artifact(c.req.param('id'),'source-'+page,await artifactBytes(c.req.raw)));});
predictionJobRoutes.get('/api/internal/compute-artifacts/:group/:id',async c=>{compute(c.get('identity'),c.env);const artifact=await service(c.env).getPinned(c.req.param('group'),c.req.param('id'));return new Response(new Uint8Array(artifact.raw).buffer,{headers:{'Content-Type':'application/octet-stream','X-Content-Sha256':artifact.sha256,'Cache-Control':'no-store'}});});

predictionJobRoutes.post('/api/internal/prediction-jobs/:id/reserve-acquisition',async c=>{compute(c.get('identity'),c.env);const value=await body(c.req.raw) as {targetDay:string;venueCode:string;raceNumber:number};if(!value||Object.keys(value).sort().join()!=='raceNumber,targetDay,venueCode')throw new Problem(400,'INVALID_BODY');return c.json(await service(c.env).reserveAcquisition(c.req.param('id'),value));});

predictionJobRoutes.get('/api/internal/prediction-jobs/:id/pricing-source',async c=>{
 compute(c.get('identity'),c.env);
 return c.json(await service(c.env).pricingSource(c.req.param('id')));
});
predictionJobRoutes.get('/api/internal/prediction-jobs/:id/pricing-source/:page',async c=>{
 compute(c.get('identity'),c.env);
 const raw=await service(c.env).pricingSource(c.req.param('id'),c.req.param('page'));
 if(!(raw instanceof Uint8Array))throw new Problem(404,'INVALID_PAGE');
 return new Response(new Uint8Array(raw).buffer,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store'}});
});
