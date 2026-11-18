import type {SavedRaceRecord} from '@boatrace/contracts';
import {Problem} from '../../modules/evaluations/domain';
import type {SavedFilter, SavedRaceRepository, SavedRow, SavedVisibility} from '../../modules/saved-races/domain';
export const SAVED_RACE_MIGRATION = `CREATE TABLE IF NOT EXISTS saved_race_records (
 id TEXT PRIMARY KEY, record_kind TEXT NOT NULL CHECK(record_kind IN ('race','prediction')), race_id TEXT NOT NULL,
 date TEXT NOT NULL, venue_code TEXT NOT NULL, venue_name TEXT, race_number INTEGER NOT NULL,
 sha256 TEXT NOT NULL, artifact_key TEXT NOT NULL UNIQUE, byte_length INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('RECEIVING','REGISTERED','HELD')),
 visibility TEXT NOT NULL CHECK(visibility IN ('PRIVATE','VISIBLE','WITHDRAWN')), error TEXT);
 CREATE INDEX IF NOT EXISTS saved_race_selection ON saved_race_records(record_kind,date,venue_code,race_id,id);
 CREATE TABLE IF NOT EXISTS saved_race_events(id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL);`;
export class D1SavedRaces implements SavedRaceRepository {
  constructor(private db: D1Database) {}
  get(id: string) { return this.db.prepare('SELECT * FROM saved_race_records WHERE id=?').bind(id).first<SavedRow>(); }
  async getMany(ids: string[]) {
    if (ids.length > 50 || new Set(ids).size !== ids.length) throw new Problem(400, 'INVALID_SAVED_IDS');
    if (!ids.length) return [];
    const result = await this.db.prepare('SELECT * FROM saved_race_records WHERE id IN (' + ids.map(() => '?').join(',') + ')').bind(...ids).all<SavedRow>();
    if (!result.success) throw new Problem(503, 'STORAGE_UNAVAILABLE');
    return result.results;
  }
  async list(filter: SavedFilter, limit: number, cursor: string | null, visible: boolean) {
    const where = ['id > ?']; const values: (string | number)[] = [cursor ?? ''];
    if (visible) where.push("state='REGISTERED' AND visibility='VISIBLE'");
    for (const [name, column] of [['kind','record_kind'], ['date','date'], ['venue','venue_code'], ['raceId','race_id']] as const) {
      if (filter[name] !== undefined) { where.push(column + '=?'); values.push(filter[name]!); }
    }
    const result = await this.db.prepare('SELECT * FROM saved_race_records WHERE ' + where.join(' AND ') + ' ORDER BY id COLLATE BINARY ASC LIMIT ?').bind(...values, limit).all<SavedRow>();
    if (!result.success) throw new Problem(503, 'STORAGE_UNAVAILABLE');
    return result.results;
  }
  async groups(kind: 'date' | 'venue', date: string | null, limit: number, cursor: string | null) {
    const column = kind === 'date' ? 'date' : 'venue_code';
    const result = await this.db.prepare(`SELECT ${column} AS value, ${kind === 'date' ? 'NULL' : 'MIN(venue_name)'} AS name FROM saved_race_records
      WHERE record_kind='race' AND state='REGISTERED' AND visibility='VISIBLE' AND ${column}>? ${date ? 'AND date=?' : ''}
      GROUP BY ${column} ORDER BY ${column} COLLATE BINARY ASC LIMIT ?`).bind(...(date ? [cursor ?? '', date, limit] : [cursor ?? '', limit])).all<{value: string; name: string | null}>();
    if (!result.success) throw new Problem(503, 'STORAGE_UNAVAILABLE');
    return result.results;
  }
  async reserve(record: SavedRaceRecord, sha: string, key: string, size: number) {
    await this.db.prepare(`INSERT INTO saved_race_records VALUES(?,?,?,?,?,?,?,?,?,?,'RECEIVING','PRIVATE',NULL) ON CONFLICT(id) DO NOTHING`)
      .bind(record.id, record.recordKind, record.raceId, record.date, record.venueCode, record.venueName, record.raceNumber, sha, key, size).run();
    const row = await this.get(record.id);
    if (!row || row.sha256 !== sha || row.artifact_key !== key || row.byte_length !== size) throw new Problem(409, 'SAVED_RECORD_ID_CONFLICT');
    return row;
  }
  async state(id: string, value: SavedRow['state'], error: string | null = null) {
    await this.db.prepare('UPDATE saved_race_records SET state=?,error=? WHERE id=?').bind(value, error, id).run();
    await this.event(id, value);
  }
  async visibility(id: string, value: SavedVisibility) {
    await this.db.prepare('UPDATE saved_race_records SET visibility=? WHERE id=?').bind(value, id).run(); await this.event(id, value);
  }
  private async event(id: string, event: string) {
    await this.db.prepare('INSERT INTO saved_race_events(record_id,event,created_at) VALUES(?,?,?)').bind(id, event, new Date().toISOString()).run();
  }
}
