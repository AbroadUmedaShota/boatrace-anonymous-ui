import {assertTransfer, type EvaluationTransfer, type LatestEvaluationResponse,
  type EvaluationListItem, type EvaluationListResponse, type EvaluationDetailResponse, type CloudView} from '@boatrace/contracts';
import {Problem, sha256, type ArtifactRepository, type EvaluationRepository, type Verified, type Visibility,
  type ArtifactKind, type EvaluationMode, type EvaluationRow} from './domain';
import {parseCloudView, cloudProvenance} from './cloud-view';
export const MAX_TRANSFER_BYTES = 256 * 1024;
function parse(bytes: Uint8Array): EvaluationTransfer {
  if (!bytes.length || bytes.length > MAX_TRANSFER_BYTES) throw new Problem(413, 'TRANSFER_SIZE_LIMIT');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); assertTransfer(value); }
  catch { throw new Problem(400, 'INVALID_TRANSFER_SCHEMA'); }
  return value;
}
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.join() === bk.join() && ak.every(k => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
async function verifyProvenance(value: EvaluationTransfer) {
  const p = value.provenance as {source_api: {summary_json_utf8: string; summary_sha256: string};
    source_refs: {kind: string; sha256: string}[]; cohort: {dates: string[]; r3_count: number; market_count: number}};
  const kinds = p.source_refs.map(ref => ref.kind);
  if (!['model', 'report', 'eval_seal', 'protocol', 'api_summary'].every(k => kinds.includes(k)) ||
      new Set(kinds).size !== kinds.length) throw new Problem(400, 'MISSING_SOURCE_REFERENCES');
  if (await sha256(new TextEncoder().encode(p.source_api.summary_json_utf8)) !== p.source_api.summary_sha256)
    throw new Problem(400, 'SOURCE_API_HASH_MISMATCH');
  let source: unknown;
  try { source = JSON.parse(p.source_api.summary_json_utf8); } catch { throw new Problem(400, 'INVALID_SOURCE_API_BYTES'); }
  if (!sameValue(source, value.summary)) throw new Problem(400, 'SOURCE_API_SUMMARY_MISMATCH');
  if (value.summary.status === 'AVAILABLE' && (!sameValue(p.cohort.dates, value.summary.paired.r3?.daily.map(d => d.date)) ||
      p.cohort.r3_count !== value.summary.paired.r3?.count || p.cohort.market_count !== value.summary.paired.market?.count ||
      p.source_refs.find(ref => ref.kind === 'model')?.sha256 !== value.summary.model_sha256))
    throw new Problem(400, 'SOURCE_COHORT_OR_MODEL_MISMATCH');
}
export class EvaluationService {
  constructor(private repo: EvaluationRepository, private artifacts: ArtifactRepository,
              private mode: EvaluationMode = 'LOCAL_COMPAT') {
    if (!['LOCAL_COMPAT', 'CLOUD_ONLY'].includes(mode)) throw new Problem(503, 'INVALID_EVALUATION_MODE');
  }
  private provenance(value: Verified) {
    return value.row.artifact_kind === 'CLOUD_VIEW'
      ? cloudProvenance(value.transfer as CloudView, value.summaryText!)
      : (value.transfer as EvaluationTransfer).provenance;
  }
  private sourceMarker(row: import('./domain').EvaluationRow) {
    return row.artifact_kind === 'CLOUD_VIEW' ? {source_type: 'CLOUD_VIEW' as const} : {};
  }
  async verify(id: string): Promise<Verified> {
    const row = await this.repo.get(id);
    if (!row) throw new Problem(404, 'EVALUATION_NOT_FOUND');
    return this.verifyRow(row);
  }
  private async verifyRow(row: EvaluationRow): Promise<Verified> {
    const id = row.evaluation_id;
    if (this.mode === 'CLOUD_ONLY' && row.artifact_kind !== 'CLOUD_VIEW') throw new Problem(404, 'EVALUATION_NOT_FOUND');
    if (!['LEGACY_TRANSFER', 'CLOUD_VIEW'].includes(row.artifact_kind)) throw new Problem(503, 'INVALID_ARTIFACT_KIND');
    const prefix = row.artifact_kind === 'CLOUD_VIEW' ? 'cloud-views' : 'transfers';
    if (row.artifact_key !== `${prefix}/${id}/${row.sha256}.json`) throw new Problem(503, 'ARTIFACT_KIND_OR_KEY_MISMATCH');
    const raw = await this.artifacts.get(row.artifact_key);
    if (!raw || raw.byteLength !== row.byte_length || await sha256(raw) !== row.sha256)
      throw new Problem(503, 'ARTIFACT_MISSING_OR_TAMPERED');
    if (row.artifact_kind === 'CLOUD_VIEW') {
      const {artifact, summaryText} = await parseCloudView(raw);
      if (artifact.evaluation_id !== id) throw new Problem(503, 'EVALUATION_LINEAGE_MISMATCH');
      return {row, transfer: artifact, summaryText};
    }
    const transfer = parse(raw); await verifyProvenance(transfer);
    if (transfer.evaluation_id !== id) throw new Problem(503, 'EVALUATION_LINEAGE_MISMATCH');
    return {row, transfer};
  }
  async register(raw: Uint8Array) {
    if (this.mode === 'CLOUD_ONLY') throw new Problem(403, 'LEGACY_DISABLED_IN_CLOUD_ONLY');
    const transfer = parse(raw);
    await verifyProvenance(transfer);
    return this.commit(raw, transfer, 'LEGACY_TRANSFER');
  }
  async registerCloud(raw: Uint8Array) {
    const {artifact} = await parseCloudView(raw);
    return this.commit(raw, artifact, 'CLOUD_VIEW');
  }
  private async commit(raw: Uint8Array, transfer: EvaluationTransfer | CloudView, kind: ArtifactKind) {
    const cloudFlags = kind === 'CLOUD_VIEW' ? {source_type: 'CLOUD_VIEW' as const, release_allowed: false, legal_approval: 'UNKNOWN'} : {};
    const sha = await sha256(raw);
    const id = transfer.evaluation_id;
    const key = `${kind === 'CLOUD_VIEW' ? 'cloud-views' : 'transfers'}/${id}/${sha}.json`;
    const row = await this.repo.reserve(id, sha, key, raw.byteLength, kind);
    if (row.state === 'REGISTERED') {
      try { await this.verify(id); } catch (error) {
        await this.repo.transition(id, 'HELD', 'ARTIFACT_MISSING_OR_TAMPERED'); throw error;
      }
      return {status: 'REGISTERED', evaluation_id: id, sha256: sha, idempotent: true, ...cloudFlags};
    }
    try {
      await this.artifacts.stage(key, raw);
      await this.repo.transition(id, 'STAGED');
      await this.verify(id);
      if (transfer.summary.status !== 'AVAILABLE') {
        await this.repo.transition(id, 'HELD', 'SOURCE_SUMMARY_HELD');
        return {status: 'HELD', evaluation_id: id, sha256: sha, idempotent: false};
      }
      await this.repo.transition(id, 'VERIFIED');
      await this.repo.transition(id, 'REGISTERED');
      return {status: 'REGISTERED', evaluation_id: id, sha256: sha, idempotent: false, ...cloudFlags};
    } catch (error) {
      await this.repo.transition(id, error instanceof Problem ? 'HELD' : 'FAILED',
        error instanceof Problem ? error.code : 'REGISTRATION_INTERRUPTED');
      throw error;
    }
  }
  async inspect(id: string) {
    const row = await this.repo.get(id);
    if (!row || (this.mode === 'CLOUD_ONLY' && row.artifact_kind !== 'CLOUD_VIEW')) throw new Problem(404, 'EVALUATION_NOT_FOUND');
    try { const value = await this.verify(id); return {...value.row, ...this.sourceMarker(row), artifact_valid: true, transfer: value.transfer}; }
    catch (error) { return {...row, artifact_valid: false, reason: error instanceof Problem ? error.code : 'STORAGE_UNAVAILABLE'}; }
  }
  private async display(row: EvaluationRow, latestId: string | null): Promise<EvaluationDetailResponse> {
    let verified: Verified | null = null;
    let reason: string | null = null;
    try {
      verified = await this.verify(row.evaluation_id);
    } catch (error) {
      reason = error instanceof Problem ? error.code : 'STORAGE_UNAVAILABLE';
    }
    // Recheck permissions even if the R2 read failed. A concurrent withdrawal
    // must not leak its ID through a HELD item or a pagination cursor.
    const current = await this.repo.get(row.evaluation_id);
    return this.displayVerified(row, current, verified, reason, latestId);
  }
  private displayVerified(row: EvaluationRow, current: EvaluationRow | null, verified: Verified | null,
                          reason: string | null, latestId: string | null): EvaluationDetailResponse {
    const base = {evaluation_id: row.evaluation_id, registration_state: current?.state ?? 'HELD' as const,
      visibility: current?.visibility ?? 'PRIVATE' as const, is_latest: row.evaluation_id === latestId,
      ...this.sourceMarker(current ?? row)};
    if (!current) reason = 'EVALUATION_NOT_FOUND';
    else if (verified && (current.sha256 !== verified.row.sha256 || current.artifact_key !== verified.row.artifact_key ||
          current.byte_length !== verified.row.byte_length || current.artifact_kind !== verified.row.artifact_kind)) reason = 'EVALUATION_CHANGED_DURING_READ';
    else if (current.state !== 'REGISTERED') reason = 'EVALUATION_NOT_REGISTERED';
    else if (verified?.transfer.summary.status !== 'AVAILABLE' && !reason) reason = 'SOURCE_SUMMARY_HELD';
    if (reason || !verified) {
      return {...base, status: 'HELD', summary: null, provenance: null,
        reasons: [...new Set([reason ?? 'STORAGE_UNAVAILABLE', ...(current?.error ? [current.error] : [])])]};
    }
    return {...base, status: 'AVAILABLE', summary: verified.transfer.summary,
      provenance: this.provenance(verified), reasons: []};
  }
  async list(limit: number, cursor: string | null, admin = false): Promise<EvaluationListResponse> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
        (cursor !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(cursor)))
      throw new Problem(400, 'INVALID_PAGINATION');
    const rows = await this.repo.list(limit + 1, cursor, !admin, this.mode === 'CLOUD_ONLY' ? 'CLOUD_VIEW' : undefined);
    const latestId = await this.repo.latest();
    const page = rows.slice(0, limit);
    const verifiedRows: {verified: Verified | null; reason: string | null}[] = [];
    for (const row of page) {
      try { verifiedRows.push({verified: await this.verifyRow(row), reason: null}); }
      catch (error) { verifiedRows.push({verified: null, reason: error instanceof Problem ? error.code : 'STORAGE_UNAVAILABLE'}); }
    }
    // One final, bounded read checks the whole page after every R2 operation.
    // No per-item re-read may precede a later R2 operation that withdraws it.
    const currentRows = await this.repo.getMany(page.map(row => row.evaluation_id));
    const currentById = new Map(currentRows.map(row => [row.evaluation_id, row]));
    if (currentById.size !== currentRows.length || currentRows.some(row => !page.some(original => original.evaluation_id === row.evaluation_id)))
      throw new Problem(503, 'INVALID_EVALUATION_RECHECK');
    const items: EvaluationListItem[] = [];
    for (const [index, row] of page.entries()) {
      const current = currentById.get(row.evaluation_id) ?? null;
      if (this.mode === 'CLOUD_ONLY' && current && current.artifact_kind !== 'CLOUD_VIEW')
        throw new Problem(409, 'EVALUATION_VISIBILITY_CHANGED');
      const {verified, reason} = verifiedRows[index];
      const detail = this.displayVerified(row, current, verified, reason, latestId);
      if (!admin && (detail.registration_state !== 'REGISTERED' || detail.visibility !== 'VISIBLE'))
        throw new Problem(409, 'EVALUATION_VISIBILITY_CHANGED');
      const {provenance: _provenance, ...item} = detail;
      items.push(item);
    }
    return {status: 'AVAILABLE', items,
      next_cursor: rows.length > limit ? rows[limit - 1].evaluation_id : null};
  }
  async detail(id: string, admin = false): Promise<EvaluationDetailResponse> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(id)) throw new Problem(400, 'INVALID_EVALUATION_ID');
    const row = await this.repo.get(id);
    if (!row || (this.mode === 'CLOUD_ONLY' && row.artifact_kind !== 'CLOUD_VIEW') ||
        (!admin && (row.state !== 'REGISTERED' || row.visibility !== 'VISIBLE')))
      throw new Problem(404, 'EVALUATION_NOT_FOUND');
    const result = await this.display(row, await this.repo.latest());
    if (!admin && (result.registration_state !== 'REGISTERED' || result.visibility !== 'VISIBLE'))
      throw new Problem(404, 'EVALUATION_NOT_FOUND');
    return result;
  }
  async visibility(id: string, value: Visibility) {
    if (!['PRIVATE', 'VISIBLE', 'SUPERSEDED', 'WITHDRAWN'].includes(value)) throw new Problem(400, 'INVALID_VISIBILITY');
    const {row, transfer} = await this.verify(id);
    if (row.state !== 'REGISTERED' || transfer.summary.status !== 'AVAILABLE') throw new Problem(409, 'EVALUATION_NOT_REGISTERED');
    await this.repo.visibility(id, value);
    return {evaluation_id: id, visibility: value};
  }
  async setLatest(id: string) {
    const {row, transfer} = await this.verify(id);
    if (row.state !== 'REGISTERED' || row.visibility !== 'VISIBLE' || transfer.summary.status !== 'AVAILABLE')
      throw new Problem(409, 'LATEST_REQUIRES_VERIFIED_VISIBLE_REGISTRATION');
    await this.repo.setLatest(id);
    return {evaluation_id: id, latest: true};
  }
  async latest(): Promise<LatestEvaluationResponse> {
    try {
      const id = await this.repo.latest();
      if (!id) return {status: 'EMPTY', reasons: ['LATEST_NOT_SELECTED']};
      const verified = await this.verify(id); const {row, transfer} = verified;
      if (row.state !== 'REGISTERED' || row.visibility !== 'VISIBLE' || transfer.summary.status !== 'AVAILABLE')
        return {status: 'HELD', reasons: ['LATEST_NOT_VERIFIED_VISIBLE']};
      return {status: 'AVAILABLE', evaluation_id: id, ...this.sourceMarker(row), summary: transfer.summary, provenance: this.provenance(verified)};
    } catch (error) { return {status: 'HELD', reasons: [error instanceof Problem ? error.code : 'STORAGE_UNAVAILABLE']}; }
  }
}
