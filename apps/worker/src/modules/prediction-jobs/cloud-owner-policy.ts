import {assertCloudOwnerPolicy,matchesSavedPredictionTarget,parseSavedPredictionTargets,type CloudOwnerPolicy,type PredictionRequest,type PredictionTarget} from '@boatrace/contracts';
import type {Bindings} from '../../composition';
import {strictJson} from '../access/strict-json';
import {Problem} from '../evaluations/domain';
export const cloudQueueTransport=(env:Bindings)=>env.JOB_TRANSPORT==='CLOUDFLARE_CONTAINERS'||env.JOB_TRANSPORT==='CLOUDFLARE_PYTHON_DO';
export const cloudOwnerRequired=(env:Bindings)=>cloudQueueTransport(env)&&!(env.LOCAL_ONLY==='true'&&env.AUTH_MODE==='LOCAL_HS256');
export function configuredSavedTargets(env:Bindings): PredictionTarget[]{
 if(env.JOB_EXECUTION_MODE==='LIVE')return [];
 try{return parseSavedPredictionTargets(strictJson(env.JOB_SAVED_TARGETS_JSON??'[]'));}catch{return [];}
}
export function configuredCloudOwnerPolicy(env:Bindings){try{const value=strictJson(env.CLOUD_OWNER_POLICY_JSON??'');assertCloudOwnerPolicy(value);return value;}catch{return null;}}
export function cloudOwnerPolicy(env:Bindings,owner:string,at=new Date()):CloudOwnerPolicy{
 try{
  const value=strictJson(env.CLOUD_OWNER_POLICY_JSON??'');assertCloudOwnerPolicy(value);
  const day=new Date(at.getTime()+32400000).toISOString().slice(0,10);
  const pins=JSON.parse(env.JOB_COMPUTE_ARTIFACTS_JSON??'{}');
  const models=JSON.parse(env.JOB_EXPECTED_MODEL_SHA256??'{}');
  if(env.JOB_TRANSPORT==='CLOUDFLARE_PYTHON_DO'&&value.profile!=='ANONYMOUS_OWNER_TRIAL')throw Error();
  if(env.LOCAL_ONLY!=='false'||env.AUTH_MODE!=='ACCESS_PRODUCTION_RS256'||env.PRODUCTION_ACCESS_ENABLED!=='true'||env.REMOTE_EXECUTION_APPROVED!=='true'||env.PREDICTION_ACCEPTANCE_ENABLED!=='true'||!env.PREDICTION_QUEUE||!env.JOB_INPUT_ID||owner!==value.ownerSubject||day<value.startJstDate||day>=value.endJstDateExclusive||Object.keys(models).sort().join()!==Object.keys(value.modelSha256).sort().join()||Object.entries(value.modelSha256).some(([k,h])=>models[k]!==h||pins['models/'+k]?.sha256!==h||typeof pins['models/'+k]?.key!=='string'||!pins['models/'+k].key)||value.profile==='LIVE_OWNER_TRIAL'&&(env.JOB_EXECUTION_MODE!=='LIVE'||env.JOB_TARGET_WORKFLOW!=='ACQUIRE_ON_REQUEST'||env.DATA_ACQUISITION_APPROVED!=='true')||value.profile==='ANONYMOUS_OWNER_TRIAL'&&(env.JOB_EXECUTION_MODE!=='SAVED_REPLAY'||env.DATA_ACQUISITION_APPROVED!=='false'))throw Error();
  return value;
 }catch{throw new Problem(409,'CLOUD_OWNER_TRIAL_CLOSED');}
}
export function cloudOwnerAdmission(env:Bindings,request:PredictionRequest,owner:string){
 const policy=cloudOwnerPolicy(env,owner);
 if(!policy.modelSha256[request.mode])throw new Problem(409,'CLOUD_OWNER_MODE_NOT_APPROVED');
 if(policy.profile==='ANONYMOUS_OWNER_TRIAL'&&!matchesSavedPredictionTarget(configuredSavedTargets(env),request))throw new Problem(409,'CLOUD_OWNER_SAVED_TARGET_NOT_APPROVED');
}
export function cloudOwnerAvailable(env:Bindings,owner:string){try{return cloudOwnerPolicy(env,owner);}catch{return null;}}
