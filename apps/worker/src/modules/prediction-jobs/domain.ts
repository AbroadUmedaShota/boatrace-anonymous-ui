import type {ArtifactRepository} from '../evaluations/domain';
import type {PredictionJob} from '@boatrace/contracts';
export type Row={id:string;owner:string;idem:string;request:string;hash:string;state:PredictionJob['state'];created_at:string;updated_at:string;lease_until:string|null;reasons:string;result:string|null;execution_mode:'SAVED_REPLAY'|'LIVE';expected_input_sha256:string|null;expected_model_sha256:string|null};
export interface JobStatement {bind(...values:(string|number|null)[]):JobStatement;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>;run():Promise<{meta:{changes:number}}>;}
export type JobOperation='usage'|'reserveAcquisition'|'dispatchUnknown'|'jobArtifacts'|'get'|'list'|'listForRace'|'byOwnerKey'|'reserve'|'reserveGuarded'|'expiredUnresolved'|'finish'|'inputHash'|'attachResult'|'artifactHash'|'reserveArtifact'|'recoverExpired'|'reserveFetch'|'claim';
export interface PredictionJobRepository {statement(operation:JobOperation):JobStatement;}

export type ComputeArtifactKind='model'|'input'|'source'|'result';
export interface ComputeArtifactRepository extends ArtifactRepository {read(key:string,kind:ComputeArtifactKind):Promise<Uint8Array|null>;}
