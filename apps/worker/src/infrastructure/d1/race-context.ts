export const RACE_CONTEXT_MIGRATION="CREATE TABLE IF NOT EXISTS race_contexts(record_id TEXT PRIMARY KEY,parent_sha256 TEXT NOT NULL,sha256 TEXT NOT NULL,artifact_key TEXT NOT NULL,byte_length INTEGER NOT NULL)";
export type ContextRow={record_id:string;parent_sha256:string;sha256:string;artifact_key:string;byte_length:number};
export interface ContextRepository {get(id:string):Promise<ContextRow|null>;reserve(row:ContextRow):Promise<void>}
export class D1RaceContexts implements ContextRepository{
 constructor(private db:D1Database){}
 get(id:string){return this.db.prepare('SELECT * FROM race_contexts WHERE record_id=?').bind(id).first<ContextRow>();}
 async reserve(r:ContextRow){await this.db.prepare('INSERT INTO race_contexts VALUES(?,?,?,?,?) ON CONFLICT(record_id) DO NOTHING').bind(r.record_id,r.parent_sha256,r.sha256,r.artifact_key,r.byte_length).run();}
}
