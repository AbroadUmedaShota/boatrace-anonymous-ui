import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtempDisposable, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {LivePrediction, PredictionJob, PredictionRequest, RaceCatalog, RaceOutcome} from '@boatrace/contracts';
import {D1ComputeArtifacts} from '../../apps/worker/src/infrastructure/d1/compute-artifacts';
import {issueToken} from '../../apps/worker/src/modules/access/auth';
import {startRuntime, type RuntimeOptions} from '../cloudflare/runtime';
import {buildWeb, startWebRuntime} from '../cloudflare/web-runtime';

const target = {date: '2030-01-01', venueCode: '01', raceNumber: 1, mode: 'BASE_SAME_DAY'} as const;
const fixture = new URL('../../fixtures/cloud-anonymous/', import.meta.url);

async function readAnonymousArtifact(name: 'input.json' | 'base-model.json') {
  const raw = await readFile(new URL(name, fixture));
  assert.equal(JSON.parse(raw.toString()).syntheticFixture, true, 'Expected a synthetic fixture');
  const sha = createHash('sha256').update(raw).digest('hex');
  return {raw, sha};
}

function combinations() {
  const lanes = [1, 2, 3, 4, 5, 6];
  const labels: string[] = [];
  for (const first of lanes) {
    for (const second of lanes) {
      for (const third of lanes) {
        if (new Set([first, second, third]).size === 3) labels.push(`${first}-${second}-${third}`);
      }
    }
  }
  assert.equal(labels.length, 120);
  return labels;
}

async function decodeJob(response: Response) {
  if (!response.ok) throw new Error(`Anonymous job fixture received HTTP ${response.status}: ${await response.text()}`);
  return (await response.json() as {job: PredictionJob}).job;
}

async function seedAnonymousPrediction(state: string, secret: string, viewer: string) {
  const [model, input] = await Promise.all([readAnonymousArtifact('base-model.json'), readAnonymousArtifact('input.json')]);
  const options: RuntimeOptions = {
    artifact_store: 'D1_BLOBS',
    prediction_artifact_store: 'D1_BLOBS',
    job_execution_mode: 'SAVED_REPLAY',
    job_saved_targets: [target],
    job_dispatch_async: true,
    job_input_id: 'anonymous-input',
    job_input_sha256: input.sha,
    job_model_sha256: model.sha,
    job_service_subject: 'local-operator',
    job_compute_artifacts: {
      'models/BASE_SAME_DAY': {key: 'pins/model', sha256: model.sha},
      'inputs/anonymous-input': {key: 'pins/input', sha256: input.sha},
    },
  };
  let dispatches = 0;
  const runtime = await startRuntime(state, 0, secret, {
    ...options,
    prediction_dispatch: async () => {
      dispatches++;
      return new Response(null, {status: 202});
    },
  });
  try {
    const artifacts = new D1ComputeArtifacts(runtime.db as unknown as D1Database);
    await artifacts.stage('pins/model', model.raw);
    await artifacts.stage('pins/input', input.raw);

    const [admin, compute] = await Promise.all([issueToken(secret, 'admin'), issueToken(secret, 'compute')]);
    const call = (route: string, token: string, body?: PredictionRequest | LivePrediction | RaceOutcome | RaceCatalog | Record<string, never>) =>
      runtime.mf.dispatchFetch(runtime.url.origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    const created = await decodeJob(await call('/api/prediction-jobs', admin, {
      ...target, idempotencyKey: 'anonymous-ci-prediction',
    }));
    assert.equal(created.state, 'QUEUED');
    const internalPath = '/api/internal/prediction-jobs/' + created.id;
    const claimed = await call(internalPath + '/claim', compute, {});
    assert.equal(claimed.status, 200);
    await claimed.arrayBuffer();
    const row = await runtime.db.prepare('SELECT hash FROM prediction_jobs WHERE id=?')
      .bind(created.id).first<{hash: string}>();
    assert.ok(row);

    // The zero-coefficient anonymous fixture yields uniform probabilities.
    // Feed its expected result through the normal claim and result API.
    const labels = combinations();
    const result: LivePrediction = {
      schemaVersion: 'boatrace-live-prediction/1',
      jobId: created.id,
      status: 'AVAILABLE',
      executionMode: 'SAVED_REPLAY',
      generatedAt: new Date().toISOString(),
      observedAt: null,
      oddsObservedAt: null,
      modelAvailableAt: null,
      modelSha256: model.sha,
      modelCreatedAt: null,
      inputSha256: input.sha,
      requestSha256: row.hash,
      sourceRefs: [input.sha, model.sha],
      reasons: ['SAVED_INPUT_REPLAY_ONLY'],
      combinations: labels,
      probabilities: labels.map(() => 1 / 120),
      finishByLane: Array.from({length: 6}, () => [1 / 6, 1 / 6, 1 / 6]),
      odds: null,
      cutoffAt: null,
      decisionAt: null,
      purchaseEligible: false,
      historicalOnly: true,
      ticketProposal: null,
    };
    const completed = await decodeJob(await call(internalPath + '/result', compute, result));
    assert.equal(completed.state, 'COMPLETED');
    const readBack = await decodeJob(await call('/api/prediction-jobs/' + created.id, viewer));
    assert.deepEqual(readBack.result, result);
    // The earlier synthetic base job is outside the real per-race cooldown.
    await runtime.db.prepare("UPDATE prediction_jobs SET created_at=datetime('now','-10 minutes') WHERE id=?")
      .bind(created.id).run();
    const exhibition = await decodeJob(await call('/api/prediction-jobs', admin, {
      ...target, mode:'R5_PRE_RACE', exhibitionOnly:true, idempotencyKey:'anonymous-ci-exhibition',
    }));
    const exhibitionPath = '/api/internal/prediction-jobs/' + exhibition.id;
    const exhibitionClaim = await call(exhibitionPath + '/claim', compute, {});
    assert.equal(exhibitionClaim.status, 200);
    await exhibitionClaim.arrayBuffer();
    const exhibitionRow = await runtime.db.prepare('SELECT hash FROM prediction_jobs WHERE id=?')
      .bind(exhibition.id).first<{hash:string}>();
    assert.ok(exhibitionRow);
    const exhibitionProbabilities = [...result.probabilities!];
    exhibitionProbabilities[0] += 0.01;
    // Shift a full percentage point overall while keeping every outcome positive.
    for(let i=100;i<120;i++)exhibitionProbabilities[i] -= 0.0005;
    const exhibitionFinishes = Array.from({length:6},(_,lane)=>Array.from({length:3},(_,position)=>
      labels.reduce((sum,label,index)=>Number(label.split('-')[position])===lane+1
        ? sum+exhibitionProbabilities[index] : sum,0)));
    const exhibited = await decodeJob(await call(exhibitionPath+'/result', compute, {
      ...result, jobId:exhibition.id, requestSha256:exhibitionRow.hash,
      generatedAt:new Date(Date.parse(result.generatedAt)+1000).toISOString(),
      probabilities:exhibitionProbabilities,finishByLane:exhibitionFinishes,
    }));
    assert.equal(exhibited.state,'COMPLETED');
    const outcomePath='/api/race-outcomes/'+target.date+'/'+target.venueCode+'/';
    const importPath='/api/race-outcomes/import';
    const registrar=await issueToken(secret,'registrar');
    const outcome:RaceOutcome={
      date:target.date,venueCode:target.venueCode,raceNumber:target.raceNumber,
      status:'FINAL',finish:[1,2,3,6,5,4],payoutYen:4321,
      sourceSha256:'a'.repeat(64),sourceSavedAt:'2030-01-01T12:30:00+09:00',
    };
    assert.deepEqual(await (await call(outcomePath+target.raceNumber,viewer)).json(),{outcome:null});
    assert.equal((await call(importPath,viewer,outcome)).status,403);
    assert.equal((await call(outcomePath+target.raceNumber,registrar)).status,403);
    for(let i=0;i<2;i++){
      const imported=await call(importPath,registrar,outcome);
      assert.equal(imported.status,200);
      assert.deepEqual(await imported.json(),{outcome});
    }
    assert.equal((await call(importPath,registrar,{...outcome,payoutYen:4322})).status,409);
    const cancelled:RaceOutcome={
      date:target.date,venueCode:target.venueCode,raceNumber:2,status:'CANCELLED',
      sourceSha256:'b'.repeat(64),sourceSavedAt:outcome.sourceSavedAt,
    };
    assert.equal((await call(importPath,registrar,cancelled)).status,200);
    assert.deepEqual(await (await call(outcomePath+'2',viewer)).json(),{outcome:cancelled});
    await runtime.db.prepare("UPDATE race_outcomes SET sha256='invalid' WHERE race_number=2").run();
    assert.equal((await call(outcomePath+'2',viewer)).status,409);
    const catalogPath='/api/race-catalog/'+target.date;
    const importCatalog='/api/race-catalog/import';
    const observedAt='2026-01-01T00:00:00.000Z';
    assert.deepEqual(await (await call(catalogPath,viewer)).json(),{catalogs:[]});
    for(let i=1;i<=13;i++){
      const catalog:RaceCatalog={date:target.date,venueCode:String(i).padStart(2,'0'),observedAt,
        sourceSha256:'c'.repeat(64),races:Array.from({length:i===13?8:12},(_,index)=>
          ({raceNumber:index+1,cutoffAt:target.date+'T10:'+String(index).padStart(2,'0')+':00+09:00',status:'SCHEDULED'}))};
      if(i===1){
        assert.equal((await call(importCatalog,viewer,catalog)).status,403);
        assert.equal((await call(importCatalog,registrar,{...catalog,races:[catalog.races[0],catalog.races[0]]})).status,400);
      }
      assert.equal((await call(importCatalog,registrar,catalog)).status,200);
      if(i===1){
        assert.equal((await call(importCatalog,registrar,catalog)).status,200);
        const newer={...catalog,observedAt:'2026-01-02T00:00:00Z',
          races:catalog.races.map(race=>race.raceNumber===2?{...race,cutoffAt:null,status:'CANCELLED' as const}:race)};
        assert.equal((await call(importCatalog,registrar,newer)).status,200);
        assert.equal((await call(importCatalog,registrar,catalog)).status,409);
      }
    }
    const catalogs=(await (await call(catalogPath,viewer)).json() as {catalogs:RaceCatalog[]}).catalogs;
    assert.equal(catalogs.reduce((total,catalog)=>total+catalog.races.length,0),152);
    assert.equal(catalogs[0].races[1].status,'CANCELLED');
    const afterOutcome=await decodeJob(await call('/api/prediction-jobs/'+exhibition.id,viewer));
    assert.deepEqual(afterOutcome,exhibited);
    assert.equal(dispatches, 2);
    assert.equal(runtime.outboundCalls(), 0);
    return {jobId: created.id, exhibitionId: exhibition.id, exhibitionResult: exhibited.result!, result, options};
  } finally {
    await runtime.mf.dispose();
  }
}

export async function startAnonymousWebSmoke(writable = false) {
  const state = await mkdtempDisposable(path.join(os.tmpdir(), 'boatrace-ci-'));
  let web: Awaited<ReturnType<typeof startWebRuntime>> | undefined;
  async function close() {
    try {
      await web?.dispose();
    } finally {
      await state.remove();
    }
  }
  try {
    const secret = randomBytes(32).toString('hex');
    await writeFile(path.join(state.path, 'auth.key'), secret, {mode: 0o600});
    const token = await issueToken(secret, writable ? 'admin' : 'viewer');
    const {jobId, exhibitionId, exhibitionResult, result, options} = await seedAnonymousPrediction(state.path, secret, token);
    await buildWeb();
    web = await startWebRuntime(state.path, 0, {...options, job_acceptance_enabled: String(writable),
      prediction_dispatch: writable ? async () => new Response(null,{status:202}) : undefined});
    const origin = web.url;
    async function completePrice(job:PredictionJob, available:boolean) {
      if(!writable)throw new Error('PRICE_FIXTURE_DISABLED');
      assert.equal(job.request.oddsFromJobId,exhibitionId);
      const compute = await issueToken(secret,'compute');
      const prefix = origin+'/api/internal/prediction-jobs/'+job.id;
      const post=(suffix:string,body:unknown)=>fetch(prefix+suffix,{method:'POST',
        headers:{Authorization:'Bearer '+compute,'Content-Type':'application/json'},body:JSON.stringify(body)});
      assert.equal((await decodeJob(await post('/claim',{}))).state,'RUNNING');
      const hash = createHash('sha256').update(JSON.stringify(job.request)).digest('hex');
      return decodeJob(await post('/result',{
        ...exhibitionResult,jobId:job.id,requestSha256:hash,sourceRefs:[],
        ...(available ? {odds:result.combinations.map(()=> '10')} :
          {status:'HELD', odds:null, combinations:[], probabilities:null, finishByLane:undefined, reasons:['PRICE_STALE']}),
      }));
    }
    return {origin, token, jobId, exhibitionId, target, result, completePrice, outboundCalls: web.outboundCalls, close};
  } catch (error) {
    await close();
    throw error;
  }
}
