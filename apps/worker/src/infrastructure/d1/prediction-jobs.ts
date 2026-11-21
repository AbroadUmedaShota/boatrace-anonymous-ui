import type {PredictionJobRepository,JobStatement} from '../../modules/prediction-jobs/domain';
const HISTORY_ORDER_AND_LIMIT = 'ORDER BY created_at DESC,id DESC LIMIT 50';
export const JOB_MIGRATION=`CREATE TABLE IF NOT EXISTS legacy_acquisition_usage(day TEXT PRIMARY KEY,jobs INTEGER NOT NULL,requests INTEGER NOT NULL,last_operation_at TEXT,last_request_at TEXT); CREATE TABLE IF NOT EXISTS prediction_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, idem TEXT NOT NULL, request TEXT NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, lease_until TEXT, reasons TEXT NOT NULL, result TEXT, execution_mode TEXT NOT NULL DEFAULT 'SAVED_REPLAY',expected_input_sha256 TEXT,expected_model_sha256 TEXT, UNIQUE(owner,idem)); CREATE UNIQUE INDEX IF NOT EXISTS one_running_prediction ON prediction_jobs(state) WHERE state='RUNNING'; CREATE TABLE IF NOT EXISTS prediction_fetch_permits (id TEXT PRIMARY KEY,job_id TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS job_compute_artifacts(job_id TEXT NOT NULL,kind TEXT NOT NULL,sha256 TEXT NOT NULL,key TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(job_id,kind));`;
const OPERATIONS:Record<string,string>={
reserveAcquisition:`UPDATE prediction_jobs SET updated_at=updated_at WHERE id=? AND state='RUNNING' AND lease_until>? AND execution_mode='LIVE' AND ?=1 AND json_extract(request,'$.date')=? AND json_extract(request,'$.venueCode')=? AND json_extract(request,'$.raceNumber')=?`,
dispatchUnknown:`UPDATE prediction_jobs SET state='HELD',reasons='["DISPATCH_OUTCOME_UNKNOWN"]',updated_at=? WHERE id=? AND state='QUEUED' AND result IS NULL`,
jobArtifacts:'SELECT kind,key,sha256 FROM job_compute_artifacts WHERE job_id=?',
get:'SELECT * FROM prediction_jobs WHERE id=?',
list:`SELECT * FROM prediction_jobs ${HISTORY_ORDER_AND_LIMIT}`,
listForRace:`SELECT * FROM prediction_jobs
 WHERE json_extract(request,'$.date')=? AND json_extract(request,'$.venueCode')=? AND json_extract(request,'$.raceNumber')=?
 ${HISTORY_ORDER_AND_LIMIT}`,
byOwnerKey:'SELECT * FROM prediction_jobs WHERE owner=? AND idem=?',
reserve:`INSERT OR IGNORE INTO prediction_jobs(id,owner,idem,request,hash,state,created_at,updated_at,lease_until,reasons,result,execution_mode,expected_input_sha256,expected_model_sha256) SELECT ?,?,?,?,?, 'QUEUED',?,?,NULL,'[]',NULL,?,?,? WHERE (SELECT count(*) FROM prediction_jobs WHERE substr(datetime(created_at,'+9 hours'),1,10)=?)+coalesce((SELECT jobs FROM legacy_acquisition_usage WHERE day=date('now','+9 hours')),0)<6 AND NOT EXISTS(SELECT 1 FROM legacy_acquisition_usage WHERE julianday(last_operation_at)>julianday('now','-300 seconds')) AND NOT EXISTS(SELECT 1 FROM prediction_jobs WHERE json_extract(request,'$.date')=? AND json_extract(request,'$.venueCode')=? AND json_extract(request,'$.raceNumber')=? AND created_at>?)`,
finish:`UPDATE prediction_jobs SET state=?,reasons=?,updated_at=? WHERE id=? AND result IS NULL AND state IN ('QUEUED','RUNNING')`,
inputHash:"SELECT sha256 FROM job_compute_artifacts WHERE job_id=? AND kind='input'",
attachResult:"UPDATE prediction_jobs SET state=?,result=?,reasons=?,updated_at=? WHERE id=? AND result IS NULL AND state='RUNNING' AND lease_until>?",
artifactHash:'SELECT sha256 FROM job_compute_artifacts WHERE job_id=? AND kind=?',
reserveArtifact:'INSERT OR IGNORE INTO job_compute_artifacts VALUES(?,?,?,?,?)',
recoverExpired:"UPDATE prediction_jobs SET state='HELD',reasons='[\"EXECUTION_OUTCOME_UNKNOWN\"]',updated_at=? WHERE result IS NULL AND ((state='RUNNING' AND lease_until<?) OR (state='QUEUED' AND created_at<?))",
reserveFetch:`INSERT OR IGNORE INTO prediction_fetch_permits SELECT ?,?,? WHERE (SELECT count(*) FROM prediction_fetch_permits WHERE substr(datetime(created_at,'+9 hours'),1,10)=?)+coalesce((SELECT requests FROM legacy_acquisition_usage WHERE day=date('now','+9 hours')),0)<24 AND NOT EXISTS(SELECT 1 FROM legacy_acquisition_usage WHERE julianday(last_request_at)>julianday('now','-3 seconds')) AND NOT EXISTS(SELECT 1 FROM prediction_fetch_permits WHERE created_at>?) AND EXISTS(SELECT 1 FROM prediction_jobs WHERE id=? AND state='RUNNING' AND execution_mode='LIVE' AND lease_until>? AND ?=1)`,
claim:"UPDATE prediction_jobs SET state='RUNNING',lease_until=?,updated_at=? WHERE id=? AND state='QUEUED'",
};
// The same expiration predicate gates the INSERT atomically and explains its rejection.
const EXPIRED_UNRESOLVED="result IS NULL AND ((state='RUNNING' AND lease_until<?) OR (state='QUEUED' AND created_at<?))";
OPERATIONS.usage=`SELECT (SELECT count(*) FROM prediction_jobs WHERE substr(datetime(created_at,'+9 hours'),1,10)=?) AS own_jobs,coalesce((SELECT jobs FROM legacy_acquisition_usage WHERE day=?),0) AS legacy_jobs,(SELECT count(*) FROM prediction_fetch_permits WHERE substr(datetime(created_at,'+9 hours'),1,10)=?) AS own_http,coalesce((SELECT requests FROM legacy_acquisition_usage WHERE day=?),0) AS legacy_http,EXISTS(SELECT 1 FROM prediction_jobs WHERE ${EXPIRED_UNRESOLVED}) AS recovery_required`;
// One price job per saved exhibition result, with the same shared daily job budget.
OPERATIONS.reserveOdds=OPERATIONS.reserve.replace(
 'AND NOT EXISTS(SELECT 1 FROM prediction_jobs WHERE json_extract(request',
 "AND NOT EXISTS(SELECT 1 FROM prediction_jobs WHERE json_extract(request,'$.oddsFromJobId') IS NOT NULL AND json_extract(request"
) + " AND NOT EXISTS(SELECT 1 FROM prediction_jobs WHERE json_extract(request,'$.oddsFromJobId')=?)";
OPERATIONS.reserveOddsGuarded=OPERATIONS.reserveOdds+' AND NOT EXISTS(SELECT 1 FROM prediction_jobs WHERE '+EXPIRED_UNRESOLVED+')';
OPERATIONS.reserveGuarded=OPERATIONS.reserve+' AND NOT EXISTS(SELECT 1 FROM prediction_jobs WHERE '+EXPIRED_UNRESOLVED+')';
OPERATIONS.expiredUnresolved='SELECT id FROM prediction_jobs WHERE '+EXPIRED_UNRESOLVED+' LIMIT 1';
export class D1PredictionJobs implements PredictionJobRepository {constructor(private db:D1Database){}statement(operation:string):JobStatement {const sql=OPERATIONS[operation];if(!sql)throw new Error('UNKNOWN_JOB_OPERATION');return this.db.prepare(sql) as JobStatement;}}
