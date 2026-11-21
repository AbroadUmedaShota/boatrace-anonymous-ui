export const RACE_OUTCOME_MIGRATION = `CREATE TABLE IF NOT EXISTS race_outcomes (
 date TEXT NOT NULL, venue_code TEXT NOT NULL, race_number INTEGER NOT NULL,
 payload TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(date, venue_code, race_number)
)`;

export type StoredOutcome = {payload:string;sha256:string};

export class D1RaceOutcomes {
 constructor(private db:D1Database) {}
 get(date:string,venue:string,race:number) {
  return this.db.prepare('SELECT payload,sha256 FROM race_outcomes WHERE date=? AND venue_code=? AND race_number=?')
    .bind(date,venue,race).first<StoredOutcome>();
 }
 async reserve(date:string,venue:string,race:number,payload:string,sha:string) {
  await this.db.prepare('INSERT INTO race_outcomes VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(date,venue,race,payload,sha).run();
 }
}
