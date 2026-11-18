import type {EvaluationTransfer, CloudView} from '@boatrace/contracts';
export type ArtifactKind = 'LEGACY_TRANSFER' | 'CLOUD_VIEW';
export type EvaluationMode = 'LOCAL_COMPAT' | 'CLOUD_ONLY';
export type Registration = 'RECEIVING' | 'STAGED' | 'VERIFIED' | 'REGISTERED' | 'HELD' | 'FAILED';
export type Visibility = 'PRIVATE' | 'VISIBLE' | 'SUPERSEDED' | 'WITHDRAWN';
export type EvaluationRow = {evaluation_id: string; sha256: string; artifact_key: string;
  state: Registration; visibility: Visibility; byte_length: number; created_at: string; updated_at: string; error: string | null;
  artifact_kind: ArtifactKind};
export class Problem extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export interface EvaluationRepository {
  reserve(id: string, sha: string, key: string, bytes: number, kind?: ArtifactKind): Promise<EvaluationRow>;
  get(id: string): Promise<EvaluationRow | null>;
  getMany(ids: string[]): Promise<EvaluationRow[]>;
  list(limit: number, cursor: string | null, visibleOnly: boolean, kind?: ArtifactKind): Promise<EvaluationRow[]>;
  transition(id: string, state: Registration, error?: string): Promise<void>;
  visibility(id: string, value: Visibility): Promise<void>;
  latest(): Promise<string | null>;
  setLatest(id: string): Promise<void>;
}
export type {ArtifactRepository} from '../artifacts/domain';
export {sha256} from '../artifacts/domain';
export type Verified = {row: EvaluationRow; transfer: EvaluationTransfer | CloudView; summaryText?: string};
