import type {ArtifactKind, EvaluationRepository, EvaluationRow, Registration, Visibility} from '../../modules/evaluations/domain';
import {Problem} from '../../modules/evaluations/domain';
export const MIGRATION = `
CREATE TABLE IF NOT EXISTS evaluations (
 evaluation_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, artifact_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('RECEIVING','STAGED','VERIFIED','REGISTERED','HELD','FAILED')),
 visibility TEXT NOT NULL CHECK(visibility IN ('PRIVATE','VISIBLE','SUPERSEDED','WITHDRAWN')),
 byte_length INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT,
 artifact_kind TEXT NOT NULL DEFAULT 'LEGACY_TRANSFER' CHECK(artifact_kind IN ('LEGACY_TRANSFER','CLOUD_VIEW')));
CREATE TABLE IF NOT EXISTS registry_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registration_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
 evaluation_id TEXT NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL);
`;
export async function migrateEvaluationKinds(db: D1Database) {
  const columns = await db.prepare('PRAGMA table_info(evaluations)').all<{name: string}>();
  if (!columns.results.some(column => column.name === 'artifact_kind')) {
    await db.prepare("ALTER TABLE evaluations ADD COLUMN artifact_kind TEXT NOT NULL DEFAULT 'LEGACY_TRANSFER' CHECK(artifact_kind IN ('LEGACY_TRANSFER','CLOUD_VIEW'))").run();
    return {status: 'MIGRATED', version: 1};
  }
  return {status: 'CURRENT', version: 1};
}
export class D1Evaluations implements EvaluationRepository {
  constructor(private db: D1Database) {}
  get(id: string) { return this.db.prepare('SELECT * FROM evaluations WHERE evaluation_id=?').bind(id).first<EvaluationRow>(); }
  async getMany(ids: string[]) {
    if (ids.length > 50 || new Set(ids).size !== ids.length ||
        ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(id)))
      throw new Problem(400, 'INVALID_EVALUATION_IDS');
    if (!ids.length) return [];
    const result = await this.db.prepare('SELECT * FROM evaluations WHERE evaluation_id IN (' + ids.map(() => '?').join(',') + ')')
      .bind(...ids).all<EvaluationRow>();
    if (!result.success) throw new Problem(503, 'STORAGE_UNAVAILABLE');
    return result.results;
  }
  async list(limit: number, cursor: string | null, visibleOnly: boolean, kind?: ArtifactKind) {
    const where = ["evaluation_id > ?"];
    if (visibleOnly) where.push("state='REGISTERED' AND visibility='VISIBLE'");
    if (kind) where.push('artifact_kind=?');
    const result = await this.db.prepare('SELECT * FROM evaluations WHERE ' + where.join(' AND ') +
      ' ORDER BY evaluation_id COLLATE BINARY ASC LIMIT ?').bind(...(kind ? [cursor ?? '', kind, limit] : [cursor ?? '', limit])).all<EvaluationRow>();
    if (!result.success) throw new Problem(503, 'STORAGE_UNAVAILABLE');
    return result.results;
  }
  async reserve(id: string, sha: string, key: string, bytes: number, kind: ArtifactKind = 'LEGACY_TRANSFER') {
    const now = new Date().toISOString();
    await this.db.prepare(`INSERT INTO evaluations(evaluation_id,sha256,artifact_key,state,visibility,byte_length,created_at,updated_at,error,artifact_kind)
      VALUES(?,?,?,'RECEIVING','PRIVATE',?,?,?,NULL,?)
      ON CONFLICT(evaluation_id) DO NOTHING`).bind(id, sha, key, bytes, now, now, kind).run();
    const row = await this.get(id);
    if (!row || row.sha256 !== sha || row.byte_length !== bytes || row.artifact_key !== key || row.artifact_kind !== kind)
      throw new Problem(409, 'EVALUATION_ID_CONFLICT');
    return row;
  }
  async transition(id: string, state: Registration, error: string | null = null) {
    const prior: Record<Registration, Registration[]> = {
      RECEIVING: [], STAGED: ['RECEIVING', 'HELD', 'FAILED'], VERIFIED: ['STAGED'], REGISTERED: ['VERIFIED'],
      HELD: ['RECEIVING', 'STAGED', 'VERIFIED', 'REGISTERED', 'HELD', 'FAILED'],
      FAILED: ['RECEIVING', 'STAGED', 'VERIFIED', 'HELD', 'FAILED'],
    };
    const row = await this.get(id);
    if (!row) throw new Problem(404, 'EVALUATION_NOT_FOUND');
    const progress = ['RECEIVING', 'STAGED', 'VERIFIED', 'REGISTERED'];
    if (row.state === state || (progress.includes(state) && progress.includes(row.state) &&
        progress.indexOf(row.state) >= progress.indexOf(state))) return;
    if (!prior[state].includes(row.state)) throw new Problem(409, 'INVALID_REGISTRATION_TRANSITION');
    const now = new Date().toISOString();
    const result = await this.db.prepare('UPDATE evaluations SET state=?,updated_at=?,error=? WHERE evaluation_id=? AND state=?')
      .bind(state, now, error, id, row.state).run();
    if (result.meta.changes !== 1) throw new Problem(409, 'REGISTRATION_STATE_CHANGED');
    await this.db.prepare('INSERT INTO registration_events(evaluation_id,event,created_at) VALUES(?,?,?)').bind(id, state, now).run();
  }
  async visibility(id: string, value: Visibility) {
    await this.db.prepare('UPDATE evaluations SET visibility=?,updated_at=? WHERE evaluation_id=?')
      .bind(value, new Date().toISOString(), id).run();
  }
  async latest() {
    const result = await this.db.prepare("SELECT value FROM registry_settings WHERE key='latest'").first<{value: string}>();
    return result?.value ?? null;
  }
  async setLatest(id: string) {
    await this.db.prepare("INSERT INTO registry_settings VALUES('latest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(id).run();
  }
}
