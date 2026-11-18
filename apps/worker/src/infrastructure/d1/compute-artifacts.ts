import type {ComputeArtifactRepository,ComputeArtifactKind} from '../../modules/prediction-jobs/domain';
import {Problem,sha256} from '../../modules/evaluations/domain';
import {COMPUTE_LIMITS} from '../r2/compute-artifacts';

// D1 rows are limited to 2,000,000 bytes. Leave room for the key and metadata;
// this limit belongs to this adapter, not the shared model artifact contract.
export const D1_COMPUTE_ARTIFACT_MAX_BYTES=1024*1024;
export const D1_COMPUTE_ARTIFACT_MIGRATION='CREATE TABLE IF NOT EXISTS compute_artifact_blobs (artifact_key TEXT PRIMARY KEY, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, payload BLOB NOT NULL)';
type Stored={sha256:unknown;byte_length:unknown;payload:unknown;payload_type:unknown;payload_length:unknown};

function validKey(key:string){
 if(typeof key!=='string'||key.length>512||!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key)||key.split('/').some(part=>!part||part==='.'||part==='..'))throw new Problem(400,'INVALID_COMPUTE_ARTIFACT_KEY');
}
function bytesFrom(row:Stored){
 const invalid=()=>new Problem(503,'COMPUTE_ARTIFACT_INVALID');
 if(row.payload_type!=='blob'||!Number.isSafeInteger(row.byte_length)||typeof row.byte_length!=='number'||row.byte_length<1||row.byte_length>D1_COMPUTE_ARTIFACT_MAX_BYTES||row.payload_length!==row.byte_length||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256))throw invalid();
 let bytes:Uint8Array;
 if(row.payload instanceof Uint8Array)bytes=new Uint8Array(row.payload);
 else if(row.payload instanceof ArrayBuffer)bytes=new Uint8Array(row.payload.slice(0));
 else if(Array.isArray(row.payload)&&row.payload.length===row.byte_length&&row.payload.every(value=>Number.isInteger(value)&&value>=0&&value<=255))bytes=Uint8Array.from(row.payload);
 else throw invalid();
 if(bytes.length!==row.byte_length)throw invalid();
 return bytes;
}

export class D1ComputeArtifacts implements ComputeArtifactRepository {
 constructor(private db:D1Database){}
 private async stored(key:string){
  const row=await this.db.prepare('SELECT sha256,byte_length,payload,typeof(payload) AS payload_type,length(payload) AS payload_length FROM compute_artifact_blobs WHERE artifact_key=?').bind(key).first<Stored>();
  if(!row)return null;
  const bytes=bytesFrom(row);
  if(await sha256(bytes)!==row.sha256)throw new Problem(503,'COMPUTE_ARTIFACT_INVALID');
  return bytes;
 }
 async read(key:string,kind:ComputeArtifactKind){
  validKey(key);
  if(!Object.hasOwn(COMPUTE_LIMITS,kind))throw new Problem(400,'INVALID_COMPUTE_ARTIFACT_KIND');
  const bytes=await this.stored(key);
  if(bytes&&bytes.length>COMPUTE_LIMITS[kind])throw new Problem(503,'COMPUTE_ARTIFACT_SIZE_LIMIT');
  return bytes;
 }
 get(key:string){return this.read(key,'result');}
 async stage(key:string,value:Uint8Array){
  validKey(key);
  if(!(value instanceof Uint8Array))throw new Problem(400,'INVALID_COMPUTE_ARTIFACT_BYTES');
  if(!value.length||value.length>D1_COMPUTE_ARTIFACT_MAX_BYTES)throw new Problem(413,'D1_COMPUTE_ARTIFACT_SIZE_LIMIT');
  // Take a snapshot before awaiting the digest or database. Caller mutation must
  // not change the bytes after their digest has been calculated.
  const bytes=new Uint8Array(value),digest=await sha256(bytes);
  await this.db.prepare('INSERT INTO compute_artifact_blobs(artifact_key,sha256,byte_length,payload) VALUES(?,?,?,?) ON CONFLICT(artifact_key) DO NOTHING').bind(key,digest,bytes.length,bytes.buffer).run();
  const existing=await this.stored(key);
  if(!existing)throw new Problem(503,'COMPUTE_ARTIFACT_NOT_STORED');
  if(existing.length!==bytes.length||existing.some((value,index)=>value!==bytes[index]))throw new Problem(409,'COMPUTE_ARTIFACT_CONFLICT');
 }
}
