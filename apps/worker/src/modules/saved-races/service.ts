import {assertSavedRaceRecord, parseJsonLexemes, type SavedRaceRecord, type SavedRecordDetail} from '@boatrace/contracts';
import {Problem, sha256} from '../evaluations/domain';
import type {ArtifactRepository, SavedFilter, SavedRaceRepository, SavedRow, SavedVisibility} from './domain';
export const MAX_SAVED_BYTES = 256 * 1024;
export function savedId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Problem(400, 'INVALID_SAVED_RECORD_ID');
  return id;
}
function parse(raw: Uint8Array): {record: SavedRaceRecord; text: string} {
  if (!raw.length || raw.length > MAX_SAVED_BYTES) throw new Problem(413, 'TRANSFER_SIZE_LIMIT');
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(raw);
    const record = parseJsonLexemes(text).value; assertSavedRaceRecord(record);
    return {record, text};
  } catch { throw new Problem(400, 'INVALID_SAVED_RECORD'); }
}
function sameRow(a: SavedRow, b: SavedRow) {
  return ['id','record_kind','race_id','date','venue_code','venue_name','race_number','sha256','artifact_key','byte_length'].every(k =>
    a[k as keyof SavedRow] === b[k as keyof SavedRow]);
}
export class SavedRaceService {
  constructor(private repo: SavedRaceRepository, private artifacts: ArtifactRepository) {}
  private async verify(row: SavedRow) {
    if (row.artifact_key !== `saved-records/${row.id}/${row.sha256}.json`) throw new Problem(503, 'SAVED_ARTIFACT_KEY_MISMATCH');
    const raw = await this.artifacts.get(row.artifact_key);
    if (!raw || raw.byteLength !== row.byte_length || await sha256(raw) !== row.sha256) throw new Problem(503, 'SAVED_ARTIFACT_MISSING_OR_TAMPERED');
    const result = parse(raw), r = result.record;
    if (r.id !== row.id || r.recordKind !== row.record_kind || r.raceId !== row.race_id || r.date !== row.date ||
        r.venueCode !== row.venue_code || r.venueName !== row.venue_name || r.raceNumber !== row.race_number)
      throw new Problem(503, 'SAVED_RECORD_LINEAGE_MISMATCH');
    return result;
  }
  async register(raw: Uint8Array) {
    const {record} = parse(raw), hash = await sha256(raw), key = `saved-records/${record.id}/${hash}.json`;
    const row = await this.repo.reserve(record, hash, key, raw.byteLength);
    if (row.state === 'REGISTERED') {
      try { await this.verify(row); } catch (error) { await this.repo.state(row.id, 'HELD', 'SAVED_ARTIFACT_MISSING_OR_TAMPERED'); throw error; }
      return {id: record.id, status: 'REGISTERED', sha256: hash, idempotent: true};
    }
    try {
      await this.artifacts.stage(key, raw); await this.verify(row); await this.repo.state(row.id, 'REGISTERED');
      return {id: record.id, status: 'REGISTERED', sha256: hash, idempotent: false};
    } catch (error) { await this.repo.state(row.id, 'HELD', error instanceof Problem ? error.code : 'STORAGE_UNAVAILABLE'); throw error; }
  }
  private async read(row: SavedRow): Promise<SavedRecordDetail> {
    try {
      const {record, text} = await this.verify(row);
      return {id: row.id, status: record.holdReasons.length ? 'HELD' : 'AVAILABLE', record, recordJsonUtf8: text, reasons: [...record.holdReasons]};
    } catch (error) {
      return {id: row.id, status: 'HELD', record: null, recordJsonUtf8: null, reasons: [error instanceof Problem ? error.code : 'STORAGE_UNAVAILABLE']};
    }
  }
  async detail(id: string, kind?: 'race' | 'prediction', admin = false) {
    const row = await this.repo.get(savedId(id));
    if (!row || (kind && row.record_kind !== kind) || (!admin && (row.state !== 'REGISTERED' || row.visibility !== 'VISIBLE')))
      throw new Problem(404, 'SAVED_RECORD_NOT_FOUND');
    const detail = await this.read(row), current = await this.repo.get(id);
    if (!current || (!admin && (current.state !== 'REGISTERED' || current.visibility !== 'VISIBLE'))) throw new Problem(404, 'SAVED_RECORD_NOT_FOUND');
    if (!sameRow(row, current)) throw new Problem(409, 'SAVED_RECORD_CHANGED');
    return detail;
  }
  async inspect(id: string) {
    const row = await this.repo.get(savedId(id)); if (!row) throw new Problem(404, 'SAVED_RECORD_NOT_FOUND');
    return {registration: row, detail: await this.detail(id, undefined, true)};
  }
  async list(filter: SavedFilter, limit: number, cursor: string | null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor !== null && !/^[a-zA-Z0-9_-]{1,160}$/.test(cursor))) throw new Problem(400, 'INVALID_PAGINATION');
    const rows = await this.repo.list(filter, limit + 1, cursor, true), page = rows.slice(0, limit);
    const items = []; for (const row of page) items.push(await this.read(row));
    const current = await this.repo.getMany(page.map(r => r.id));
    if (current.length !== page.length || page.some(r => !current.some(c => c.id === r.id && sameRow(r,c) && c.state === 'REGISTERED' && c.visibility === 'VISIBLE')))
      throw new Problem(409, 'SAVED_VISIBILITY_CHANGED');
    return {status: 'AVAILABLE' as const, items, nextCursor: rows.length > limit ? page.at(-1)!.id : null};
  }
  async groups(kind: 'date' | 'venue', date: string | null, limit: number, cursor: string | null) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Problem(400, 'INVALID_PAGINATION');
    const rows = await this.repo.groups(kind, date, limit + 1, cursor), page = rows.slice(0, limit);
    // Recheck the grouped selection at the final read boundary as well.
    if (JSON.stringify(rows) !== JSON.stringify(await this.repo.groups(kind, date, limit + 1, cursor))) throw new Problem(409, 'SAVED_VISIBILITY_CHANGED');
    return {status: 'AVAILABLE' as const, items: page.map(r => kind === 'date' ? {date: r.value} : {venueCode: r.value, venueName: r.name}),
      nextCursor: rows.length > limit ? page.at(-1)!.value : null};
  }
  async visibility(id: string, value: SavedVisibility) {
    savedId(id);
    if (!['PRIVATE','VISIBLE','WITHDRAWN'].includes(value)) throw new Problem(400, 'INVALID_VISIBILITY');
    const row = await this.repo.get(id); if (!row) throw new Problem(404, 'SAVED_RECORD_NOT_FOUND');
    // Withdrawal is allowed even when an artifact is missing or corrupt.
    if (value === 'VISIBLE') { if (row.state !== 'REGISTERED') throw new Problem(409, 'SAVED_RECORD_NOT_REGISTERED'); await this.verify(row); }
    await this.repo.visibility(id, value); return {id, visibility: value};
  }
}
