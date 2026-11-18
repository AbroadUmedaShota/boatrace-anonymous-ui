import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtempDisposable, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {LivePrediction, PredictionJob, PredictionRequest} from '@boatrace/contracts';
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
    const call = (route: string, token: string, body?: PredictionRequest | LivePrediction | Record<string, never>) =>
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
    assert.equal(dispatches, 1);
    assert.equal(runtime.outboundCalls(), 0);
    return {jobId: created.id, result, options};
  } finally {
    await runtime.mf.dispose();
  }
}

export async function startAnonymousWebSmoke() {
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
    const token = await issueToken(secret, 'viewer');
    const {jobId, result, options} = await seedAnonymousPrediction(state.path, secret, token);
    await buildWeb();
    web = await startWebRuntime(state.path, 0, {...options, job_acceptance_enabled: 'false'});
    return {origin: web.url, token, jobId, target, result, outboundCalls: web.outboundCalls, close};
  } catch (error) {
    await close();
    throw error;
  }
}
