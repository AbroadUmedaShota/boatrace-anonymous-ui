export const RACE_CATALOG_MIGRATION = `CREATE TABLE IF NOT EXISTS race_catalogs (
 date TEXT NOT NULL, venue_code TEXT NOT NULL, observed_ms INTEGER NOT NULL,
 payload TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(date, venue_code)
)`;

export type StoredCatalog={date:string;venue_code:string;observed_ms:number;payload:string;sha256:string};

export class D1RaceCatalogs {
 constructor(private db:D1Database) {}
 list(date:string) {
  return this.db.prepare('SELECT * FROM race_catalogs WHERE date=? ORDER BY venue_code').bind(date).all<StoredCatalog>();
 }
 get(date:string,venue:string) {
  return this.db.prepare('SELECT * FROM race_catalogs WHERE date=? AND venue_code=?').bind(date,venue).first<StoredCatalog>();
 }
 async publish(date:string,venue:string,observedMs:number,payload:string,sha256:string) {
  await this.db.prepare(`INSERT INTO race_catalogs VALUES(?,?,?,?,?)
    ON CONFLICT(date,venue_code) DO UPDATE SET observed_ms=excluded.observed_ms,payload=excluded.payload,sha256=excluded.sha256
    WHERE excluded.observed_ms>race_catalogs.observed_ms`).bind(date,venue,observedMs,payload,sha256).run();
 }
}
