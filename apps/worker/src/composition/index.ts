import {predictionAcceptanceEnabled} from '../modules/prediction-jobs/acceptance';
import {cloudOwnerAdmission,cloudOwnerRequired,cloudQueueTransport} from '../modules/prediction-jobs/cloud-owner-policy';
import {Problem} from '../modules/evaluations/domain';
import {cloudTasksDispatch,type CloudTasksConfig} from '../infrastructure/cloud-tasks/dispatcher';
import {D1PredictionJobs} from '../infrastructure/d1/prediction-jobs';
import {R2ComputeArtifacts} from '../infrastructure/r2/compute-artifacts';
import {D1ComputeArtifacts} from '../infrastructure/d1/compute-artifacts';
import {D1Artifacts} from '../infrastructure/d1/artifacts';
import {PredictionJobs} from '../modules/prediction-jobs/service';
import {D1Evaluations} from '../infrastructure/d1/evaluations';
import {R2Artifacts} from '../infrastructure/r2/artifacts';
import {EvaluationService} from '../modules/evaluations/service';
import type {AuthBindings} from '../modules/access/auth';
import {D1SavedRaces} from '../infrastructure/d1/saved-races';
import {SavedRaceService} from '../modules/saved-races/service';
import {queuesDispatch} from '../infrastructure/queues/dispatcher';
import type {ComputeDispatchRequest} from '../../../../packages/contracts/src/compute-dispatch';
export type Bindings = AuthBindings & {CLOUD_OWNER_POLICY_JSON?:string; ASSETS?:Fetcher; DB: D1Database; ARTIFACTS?: R2Bucket; ARTIFACT_STORE?:'R2'|'D1_BLOBS'; PREDICTION_ARTIFACT_STORE?:'R2'|'D1_BLOBS'; PREDICTION_ACCEPTANCE_ENABLED?:string; JOB_TARGET_WORKFLOW?:'ACQUIRE_ON_REQUEST'; JOB_SAVED_TARGETS_JSON?:string; JOB_EXECUTION_MODE?:'LIVE'|'SAVED_REPLAY'; DATA_ACQUISITION_APPROVED?:string; JOB_COMPUTE_ARTIFACTS_JSON?:string; JOB_TRANSPORT?:'LOCAL'|'CLOUD_TASKS'|'CLOUDFLARE_CONTAINERS'|'CLOUDFLARE_PYTHON_DO'; PREDICTION_QUEUE?:Queue<ComputeDispatchRequest>; REMOTE_EXECUTION_APPROVED?:string; PREDICTION_CLOUD_TASKS_CONFIG?:string; PREDICTION_DISPATCH?: Fetcher; JOB_DISPATCH_ASYNC?:string; JOB_INPUT_ID?:string; JOB_EXPECTED_INPUT_SHA256?:string; JOB_EXPECTED_MODEL_SHA256?:string; JOB_REQUESTER_SUBJECTS_JSON?:string; JOB_SERVICE_SUBJECT?:string; EVALUATION_MODE?: 'LOCAL_COMPAT' | 'CLOUD_ONLY'};
export function composeArtifacts(env:Bindings){
 if(env.ARTIFACT_STORE==='D1_BLOBS')return new D1Artifacts(env.DB);
 if(env.ARTIFACT_STORE!==undefined&&env.ARTIFACT_STORE!=='R2')throw new Problem(503,'ARTIFACT_STORE_INVALID');
 if(!env.ARTIFACTS)throw new Problem(503,'R2_ARTIFACT_STORAGE_NOT_CONFIGURED');return new R2Artifacts(env.ARTIFACTS);
}
export function composeComputeArtifacts(env:Bindings){
 if(env.PREDICTION_ARTIFACT_STORE==='D1_BLOBS')return new D1ComputeArtifacts(env.DB);
 if(env.PREDICTION_ARTIFACT_STORE!==undefined&&env.PREDICTION_ARTIFACT_STORE!=='R2')throw new Problem(503,'PREDICTION_ARTIFACT_STORE_INVALID');
 if(!env.ARTIFACTS)throw new Problem(503,'R2_ARTIFACT_STORAGE_NOT_CONFIGURED');return new R2ComputeArtifacts(env.ARTIFACTS);
}
export const compose = (env: Bindings) => new EvaluationService(new D1Evaluations(env.DB), composeArtifacts(env), env.EVALUATION_MODE ?? 'LOCAL_COMPAT');
export const composeSavedRaces = (env: Bindings) => new SavedRaceService(new D1SavedRaces(env.DB), composeArtifacts(env));

export function composePredictionJobs(env:Bindings){
 let dispatch=env.PREDICTION_DISPATCH;const remote=env.JOB_TRANSPORT==='CLOUD_TASKS';
 if(remote){dispatch={fetch:async(input:RequestInfo,init?:RequestInit)=>{if(env.REMOTE_EXECUTION_APPROVED!=='true'||!env.PREDICTION_CLOUD_TASKS_CONFIG)throw new Problem(503,'REMOTE_EXECUTION_NOT_APPROVED');const config=JSON.parse(env.PREDICTION_CLOUD_TASKS_CONFIG) as CloudTasksConfig;return cloudTasksDispatch(new Request(input,init),config);}} as Fetcher;}
 const queued=cloudQueueTransport(env);
 if(queued){dispatch={fetch:async(input:RequestInfo,init?:RequestInit)=>{const local=env.LOCAL_ONLY==='true'&&env.AUTH_MODE==='LOCAL_HS256';if(!local&&env.REMOTE_EXECUTION_APPROVED!=='true')throw new Problem(503,'REMOTE_EXECUTION_NOT_APPROVED');if(!env.PREDICTION_QUEUE)throw new Problem(503,'PREDICTION_QUEUE_NOT_CONFIGURED');return queuesDispatch(new Request(input,init),env.PREDICTION_QUEUE);}} as Fetcher;}
 return new PredictionJobs(new D1PredictionJobs(env.DB),dispatch,env.JOB_INPUT_ID,composeComputeArtifacts(env),env.JOB_EXPECTED_INPUT_SHA256,env.JOB_EXPECTED_MODEL_SHA256,remote||queued||env.JOB_DISPATCH_ASYNC==='true',env.JOB_EXECUTION_MODE==='LIVE'?'LIVE':'SAVED_REPLAY',JSON.parse(env.JOB_COMPUTE_ARTIFACTS_JSON??'{}'),env.DATA_ACQUISITION_APPROVED==='true',queued||env.JOB_TARGET_WORKFLOW==='ACQUIRE_ON_REQUEST',env.JOB_TARGET_WORKFLOW==='ACQUIRE_ON_REQUEST',(request,owner)=>{if(!predictionAcceptanceEnabled(env))throw new Problem(409,'PREDICTION_ACCEPTANCE_CLOSED');if(env.JOB_TRANSPORT==='CLOUDFLARE_PYTHON_DO'&&env.JOB_EXECUTION_MODE==='LIVE')throw new Problem(409,'PYTHON_DO_LIVE_NOT_SUPPORTED');if(cloudOwnerRequired(env))cloudOwnerAdmission(env,request,owner);});
}
