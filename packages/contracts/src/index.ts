import validate from './generated-transfer-validator.js';
import {list as validateList, detail as validateDetail, session as validateSession} from './generated-response-validators.js';
import validateCloud from './generated-cloud-validator.js';
import {parseJsonLexemes, sameJsonValue} from './strict-json';
export * from './saved-races';
export {parseJsonLexemes} from './strict-json';

export type Metrics = {log_loss: number; third_nll: number; brier_sum: number; top1: number};
export type PairSummary = {
  count: number; models: Record<string, Metrics>; delta: Metrics;
  daily: {date: string; count: number; log_loss_delta: number | null}[];
  day_balanced_delta: number;
  interval: {low: number; high: number; includes_zero: boolean; mean: number;
    method: 'DESCRIPTIVE_DAY_BOOTSTRAP'; formal_significance_test: false};
};
export type EvaluationSummary = {
  schema_version: 'rank-evaluation-summary/1'; status: 'AVAILABLE' | 'HELD'; reasons: string[];
  known_results: true; new_holdout: false; operational_eligible: false; predictive_usefulness_established: false;
  period: {start: string; end: string; days: number} | null;
  model_sha256: string | null; created_at: string | null; model_created_at: string | null; model_fitted_at: string | null;
  paired: {r3?: PairSummary; market?: PairSummary};
  invariants: {tolerance: number; compared_forecast_count: number; prefix_passed: boolean;
    stage_loss_passed: boolean; first_max_absolute_delta: number; second_max_absolute_delta: number;
    ordered_pair_max_absolute_delta: number; stage_log_loss_delta: number[]} | null;
};
export type EvaluationTransfer = {schema_version: 'boatrace-evaluation-transfer/1'; evaluation_id: string;
  summary: EvaluationSummary; provenance: Record<string, unknown>};
export type CloudReferences = {transfer_sha256: string; summary_sha256: string; model_sha256: string;
  report_sha256: string; evaluation_seal_sha256: string; forecast_seal_sha256: string;
  protocol_sha256: string; model_protocol_sha256: string; evaluation_claim_sha256: string};
export type CloudView = {schema_version: 'boatrace-cloud-view/1'; evaluation_id: string; summary: EvaluationSummary;
  references: CloudReferences; release_allowed: false; legal_approval: 'UNKNOWN'};
export type CloudProvenance = {schema_version: 'boatrace-cloud-view-provenance/1'; references: CloudReferences;
  summary_json_utf8: string; release_allowed: false; legal_approval: 'UNKNOWN'; notice: 'LOCAL_CANDIDATE_NOT_RELEASED'};
export type LatestEvaluationResponse = {status: 'AVAILABLE'; evaluation_id: string;
  source_type?: 'LEGACY_TRANSFER' | 'CLOUD_VIEW';
  summary: EvaluationSummary; provenance: Record<string, unknown> | CloudProvenance} | {status: 'EMPTY' | 'HELD'; reasons: string[]};
export type RegistrationState = 'RECEIVING' | 'STAGED' | 'VERIFIED' | 'REGISTERED' | 'HELD' | 'FAILED';
export type EvaluationVisibility = 'PRIVATE' | 'VISIBLE' | 'SUPERSEDED' | 'WITHDRAWN';
export type EvaluationListItem = {evaluation_id: string; registration_state: RegistrationState;
  source_type?: 'LEGACY_TRANSFER' | 'CLOUD_VIEW';
  visibility: EvaluationVisibility; is_latest: boolean; reasons: string[]} &
  ({status: 'AVAILABLE'; summary: EvaluationSummary} | {status: 'HELD'; summary: null});
export type EvaluationListResponse = {status: 'AVAILABLE'; items: EvaluationListItem[]; next_cursor: string | null};
export type EvaluationDetailResponse = EvaluationListItem & {provenance: Record<string, unknown> | CloudProvenance | null};
export type EvaluationSession = {role: 'viewer' | 'admin' | 'registrar';
  authentication: 'LOCAL_SIGNED_TOKEN' | 'ACCESS_COMPATIBLE_LOCAL_FIXTURE' | 'ACCESS_HTTPS_JWKS_LOCAL_INTEGRATION'; local_only: true; actual_access_verified?: false};

function validDate(value: string): boolean {
  const date = new Date(value + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1 &&
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function assertCloudView(value: unknown): asserts value is CloudView {
  if (!validateCloud(value)) throw new Error('INVALID_CLOUD_VIEW_SCHEMA');
  const cloud = value as CloudView;
  assertCloudSummary(cloud.summary);
  if (cloud.evaluation_id !== 'eval-' + cloud.references.summary_sha256 || cloud.references.model_sha256 !== cloud.summary.model_sha256)
    throw new Error('INVALID_CLOUD_ID_OR_MODEL');
}
function assertCloudSummary(s: EvaluationSummary) {
  assertSummaryConsistency(s);
  for (const stamp of [s.created_at, s.model_created_at, s.model_fitted_at]) {
    if (typeof stamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ||
        !validDate(stamp.slice(0, 10)) || !Number.isFinite(Date.parse(stamp))) throw new Error('INVALID_CLOUD_TIMESTAMP');
  }
  if (!s.period || !validDate(s.period.start) || !validDate(s.period.end)) throw new Error('INVALID_CLOUD_PERIOD');
  const start = Date.parse(s.period.start + 'T00:00:00Z');
  const dates = Array.from({length: s.period.days}, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  if (dates.at(-1) !== s.period.end) throw new Error('INVALID_CLOUD_PERIOD');
  for (const pair of Object.values(s.paired)) {
    if (!pair || !Number.isSafeInteger(pair.count) || pair.count < 1 || pair.daily.some((row, i) =>
      row.date !== dates[i] || !Number.isSafeInteger(row.count) || row.count < 0 || (row.count === 0 ? row.log_loss_delta !== null : row.log_loss_delta === null)))
      throw new Error('INVALID_CLOUD_COHORT');
    for (const metrics of Object.values(pair.models)) if (metrics.top1 < 0 || metrics.top1 > 1 ||
      metrics.log_loss < 0 || metrics.third_nll < 0 || metrics.brier_sum < 0) throw new Error('INVALID_CLOUD_METRIC');
    const interval = pair.interval;
    if (interval.low > interval.high || interval.includes_zero !== (interval.low <= 0 && interval.high >= 0)) throw new Error('INVALID_CLOUD_INTERVAL');
  }
  const inv = s.invariants;
  if (!inv || !Number.isSafeInteger(inv.compared_forecast_count) || inv.compared_forecast_count < 1 || inv.tolerance !== 1e-12 ||
      inv.prefix_passed !== true || inv.stage_loss_passed !== true ||
      [inv.first_max_absolute_delta, inv.second_max_absolute_delta, inv.ordered_pair_max_absolute_delta].some(v => v < 0 || v > inv.tolerance))
    throw new Error('INVALID_CLOUD_INVARIANTS');
}
function assertCloudRead(evaluation_id: string, summary: EvaluationSummary, provenance: Record<string, unknown> | CloudProvenance) {
  const p = provenance as CloudProvenance;
  assertCloudView({schema_version: 'boatrace-cloud-view/1', evaluation_id, summary, references: p.references,
    release_allowed: p.release_allowed, legal_approval: p.legal_approval});
  if (!sameJsonValue(parseJsonLexemes(p.summary_json_utf8).value, summary)) throw new Error('CLOUD_SUMMARY_TEXT_MISMATCH');
}

export function assertTransfer(value: unknown): asserts value is EvaluationTransfer {
  if (!validate(value)) throw new Error('INVALID_TRANSFER_SCHEMA');
  const transfer = value as EvaluationTransfer;
  assertSummaryConsistency(transfer.summary);
}
function assertSummaryConsistency(summary: EvaluationSummary) {
  if (summary.status === 'AVAILABLE') {
    if (!summary.period || !summary.paired.r3 || !summary.paired.market || !summary.invariants)
      throw new Error('INVALID_AVAILABLE_SUMMARY');
    for (const [name, pair] of Object.entries(summary.paired)) {
      const expected = name === 'r3' ? ['R3', 'R5'] : ['MARKET', 'R5'];
      if (Object.keys(pair.models).sort().join() !== expected.sort().join() ||
          pair.daily.length !== summary.period.days ||
          new Set(pair.daily.map(d => d.date)).size !== pair.daily.length ||
          pair.daily.reduce((total, row) => total + row.count, 0) !== pair.count)
        throw new Error('INVALID_PAIRED_COHORT');
    }
  }
}
export function parseEvaluationList(value: unknown): EvaluationListResponse {
  if (!validateList(value)) throw new Error('INVALID_EVALUATION_LIST');
  const result = value as EvaluationListResponse;
  for (let i = 0; i < result.items.length; i++) {
    const item = result.items[i];
    if (i > 0 && result.items[i - 1].evaluation_id >= item.evaluation_id) throw new Error('INVALID_EVALUATION_LIST_ORDER');
    if (item.status === 'AVAILABLE') {
      assertSummaryConsistency(item.summary);
      if (item.source_type === 'CLOUD_VIEW') assertCloudSummary(item.summary);
    }
  }
  if (result.next_cursor !== null && result.next_cursor !== result.items.at(-1)?.evaluation_id)
    throw new Error('INVALID_EVALUATION_LIST_CURSOR');
  return result;
}
export function parseEvaluationDetail(value: unknown): EvaluationDetailResponse {
  if (!validateDetail(value)) throw new Error('INVALID_EVALUATION_DETAIL');
  const result = value as EvaluationDetailResponse;
  if (result.status === 'AVAILABLE') assertSummaryConsistency(result.summary);
  if (result.status === 'AVAILABLE' && result.source_type === 'CLOUD_VIEW' && result.provenance)
    assertCloudRead(result.evaluation_id, result.summary, result.provenance);
  return result;
}
export function parseEvaluationSession(value: unknown): EvaluationSession {
  if (!validateSession(value)) throw new Error('INVALID_EVALUATION_SESSION');
  return value as EvaluationSession;
}
export function isTransfer(value: unknown): value is EvaluationTransfer {
  try { assertTransfer(value); return true; } catch { return false; }
}
export function parseLatestEvaluation(value: unknown): LatestEvaluationResponse {
  if (!value || typeof value !== 'object') throw new Error('INVALID_LATEST_RESPONSE');
  const result = value as Record<string, unknown>;
  if (result.status === 'EMPTY' || result.status === 'HELD') {
    if (Object.keys(result).sort().join() !== 'reasons,status' || !Array.isArray(result.reasons) ||
        !result.reasons.every(v => typeof v === 'string')) throw new Error('INVALID_LATEST_RESPONSE');
    return result as LatestEvaluationResponse;
  }
  if (result.status !== 'AVAILABLE' || Object.keys(result).filter(k => k !== 'source_type').sort().join() !== 'evaluation_id,provenance,status,summary' ||
      (result.source_type !== undefined && !['CLOUD_VIEW', 'LEGACY_TRANSFER'].includes(result.source_type as string)))
    throw new Error('INVALID_LATEST_RESPONSE');
  if (result.source_type === 'CLOUD_VIEW') {
    parseEvaluationDetail({...result, registration_state: 'REGISTERED', visibility: 'VISIBLE', is_latest: true, reasons: []});
    return result as LatestEvaluationResponse;
  }
  assertTransfer({schema_version: 'boatrace-evaluation-transfer/1', evaluation_id: result.evaluation_id,
    summary: result.summary, provenance: result.provenance});
  if ((result.summary as EvaluationSummary).status !== 'AVAILABLE') throw new Error('INVALID_LATEST_RESPONSE');
  return result as LatestEvaluationResponse;
}

export * from './prediction-jobs';
export * from './compute-dispatch';
export * from './cloud-owner-policy';
