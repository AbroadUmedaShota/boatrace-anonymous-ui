import {RACE_CONTEXT_MIGRATION} from '../../apps/worker/src/infrastructure/d1/race-context';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdir, readFile, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {MIGRATION, migrateEvaluationKinds} from '../../apps/worker/src/infrastructure/d1/evaluations';
import {SAVED_RACE_MIGRATION} from '../../apps/worker/src/infrastructure/d1/saved-races';
import type {AuthBindings} from '../../apps/worker/src/modules/access/auth';
import {JOB_MIGRATION} from '../../apps/worker/src/infrastructure/d1/prediction-jobs';
import {D1_COMPUTE_ARTIFACT_MIGRATION} from '../../apps/worker/src/infrastructure/d1/compute-artifacts';
export type JwksFixture = {url: string; body: string; status?: number; delay_ms?: number};
export type RuntimeOptions = {artifact_store?:'R2'|'D1_BLOBS';prediction_artifact_store?:'R2'|'D1_BLOBS';job_target_workflow?:'ACQUIRE_ON_REQUEST';job_saved_targets?:{mode:string;date:string;venueCode:string;raceNumber:number}[];job_acceptance_enabled?:string;expected_worker_sha256?:string;legacy_usage?:{day:string;jobs:number;requests:number;lastOperationAt:string|null;lastRequestAt:string|null}[];prediction_dispatch?: (request:Request)=>Promise<Response>; job_execution_mode?:'SAVED_REPLAY'|'LIVE';data_acquisition_approved?:boolean;job_compute_artifacts?:Record<string,{key:string;sha256:string}>;job_dispatch_async?:boolean; job_input_id?:string|Record<string,string>; job_input_sha256?:string|Record<string,string>; job_model_sha256?:string|Record<string,string>; job_requester_subjects?:string[]; job_service_subject?:string; evaluation_mode?: 'LOCAL_COMPAT' | 'CLOUD_ONLY'; authentication?: AuthBindings;
  jwks_fixture?: JwksFixture | (() => JwksFixture)};
/** Independent store selections; omitted generic store preserves legacy prediction-only runs. */
export function runtimeArtifactStores(options:Pick<RuntimeOptions,'artifact_store'|'prediction_artifact_store'>){
  for(const value of [options.artifact_store,options.prediction_artifact_store])
    if(value!==undefined&&value!=='R2'&&value!=='D1_BLOBS')throw new Error('UNKNOWN_ARTIFACT_STORE');
  const artifact=options.artifact_store??'R2',prediction=options.prediction_artifact_store??'R2';
  const legacyPredictionOnly=options.artifact_store===undefined&&prediction==='D1_BLOBS';
  return {artifact,prediction,r2Required:!legacyPredictionOnly&&(artifact==='R2'||prediction==='R2'),d1BlobsRequired:artifact==='D1_BLOBS'||prediction==='D1_BLOBS',legacyPredictionOnly};
}
// @ts-expect-error generator is a Node-only ESM build helper
import {generateContract} from './generate-contract.mjs';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function privateState(value: string, create = false): Promise<string> {
  if (!path.isAbsolute(value) || value.startsWith('\\\\') || value.startsWith('//')) throw new Error('ABSOLUTE_PRIVATE_STATE_REQUIRED');
  const resolved = path.resolve(value);
  let current = resolved;
  while (true) {
    let entry;
    try { entry = await lstat(current); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (entry?.isSymbolicLink()) throw new Error('STATE_LINK_FORBIDDEN');
    if (entry?.isDirectory()) {
      try { await lstat(path.join(current, '.git')); throw new Error('GIT_STATE_FORBIDDEN'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  if (create) await mkdir(resolved, {recursive: true, mode: 0o700});
  return realpath(resolved);
}
export async function startRuntime(state: string, port = 0, secret?: string, options: RuntimeOptions = {}) {
  const stores=runtimeArtifactStores(options);
  state = await privateState(state);
  const auth = secret ?? (await readFile(path.join(state, 'auth.key'), 'utf8')).trim();
  await generateContract();
  const bundle = await build({entryPoints: [path.join(REPO, 'apps/worker/src/index.ts')], bundle: true,
    format: 'esm', platform: 'browser', target: 'es2022', write: false});
  if(options.expected_worker_sha256&&createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex')!==options.expected_worker_sha256)throw new Error('WORKER_BUNDLE_PIN_MISMATCH');
  let outboundCalls = 0, jwksFixtureCalls = 0;
  const mf = new Miniflare({modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-06-11', host: '127.0.0.1', port,
    bindings: {...(options.authentication ?? {AUTH_MODE: 'LOCAL_HS256', LOCAL_AUTH_SECRET: auth}),
      LOCAL_ONLY: 'true', ARTIFACT_STORE:stores.artifact, PREDICTION_ARTIFACT_STORE:stores.prediction, JOB_TARGET_WORKFLOW:options.job_target_workflow??'',JOB_SAVED_TARGETS_JSON:JSON.stringify(options.job_saved_targets??[]), ...(options.job_acceptance_enabled===undefined?{}:{PREDICTION_ACCEPTANCE_ENABLED:options.job_acceptance_enabled}), JOB_EXECUTION_MODE:options.job_execution_mode??'SAVED_REPLAY',DATA_ACQUISITION_APPROVED:String(options.data_acquisition_approved??false),JOB_COMPUTE_ARTIFACTS_JSON:JSON.stringify(options.job_compute_artifacts??{}),JOB_DISPATCH_ASYNC:String(options.job_dispatch_async??false),JOB_INPUT_ID:typeof options.job_input_id==='object'?JSON.stringify(options.job_input_id):options.job_input_id??'',JOB_EXPECTED_INPUT_SHA256:typeof options.job_input_sha256==='object'?JSON.stringify(options.job_input_sha256):options.job_input_sha256??'',JOB_EXPECTED_MODEL_SHA256:typeof options.job_model_sha256==='object'?JSON.stringify(options.job_model_sha256):options.job_model_sha256??'', JOB_REQUESTER_SUBJECTS_JSON:JSON.stringify(options.job_requester_subjects??[]), JOB_SERVICE_SUBJECT:options.job_service_subject??'', EVALUATION_MODE: options.evaluation_mode ?? 'LOCAL_COMPAT'},
    serviceBindings: options.prediction_dispatch ? {PREDICTION_DISPATCH: options.prediction_dispatch} : undefined,
    d1Databases: {DB: 'evaluations-local'}, r2Buckets:stores.r2Required?{ARTIFACTS:'evaluations-local'}:undefined,
    d1Persist: path.join(state, 'd1'), r2Persist: path.join(state, 'r2'),
    outboundService: async request => {
      const fixture = typeof options.jwks_fixture === 'function' ? options.jwks_fixture() : options.jwks_fixture;
      if (options.authentication?.AUTH_MODE === 'ACCESS_HTTPS_JWKS_RS256' && fixture && request.method === 'GET' &&
          request.url === options.authentication.ACCESS_JWKS_URL && request.url === fixture.url) {
        jwksFixtureCalls++;
        if (fixture.delay_ms) await new Promise(resolve => setTimeout(resolve, fixture.delay_ms));
        return new Response(fixture.body, {status: fixture.status ?? 200, headers: {'Content-Type': 'application/json'}});
      }
      outboundCalls++; return new Response('OUTBOUND_DISABLED', {status: 503});
    }});
  try {
    const db = await mf.getD1Database('DB');
    // D1 exec expects each statement on one physical line.
    for (const statement of (MIGRATION + SAVED_RACE_MIGRATION + JOB_MIGRATION + ";" + RACE_CONTEXT_MIGRATION+(stores.d1BlobsRequired?';'+D1_COMPUTE_ARTIFACT_MIGRATION:'')).split(';').map(s => s.trim()).filter(Boolean))
      await db.prepare(statement).run();
    const jobColumns=(await db.prepare('PRAGMA table_info(prediction_jobs)').all<{name:string}>()).results.map(c=>c.name);
    for(const [name,type] of [['execution_mode',"TEXT NOT NULL DEFAULT 'SAVED_REPLAY'"],['expected_input_sha256','TEXT'],['expected_model_sha256','TEXT']])if(!jobColumns.includes(name))await db.prepare('ALTER TABLE prediction_jobs ADD COLUMN '+name+' '+type).run();
    await migrateEvaluationKinds(db as unknown as D1Database);
    for(const u of options.legacy_usage??[])await db.prepare("INSERT INTO legacy_acquisition_usage VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET jobs=max(jobs,excluded.jobs),requests=max(requests,excluded.requests),last_operation_at=max(coalesce(last_operation_at,''),coalesce(excluded.last_operation_at,'')),last_request_at=max(coalesce(last_request_at,''),coalesce(excluded.last_request_at,''))").bind(u.day,u.jobs,u.requests,u.lastOperationAt,u.lastRequestAt).run();
    return {mf, db, url: await mf.ready, outboundCalls: () => outboundCalls,
      jwksFixtureCalls: () => jwksFixtureCalls, realOutboundCalls: () => 0};
  } catch (error) { await mf.dispose(); throw error; }
}
