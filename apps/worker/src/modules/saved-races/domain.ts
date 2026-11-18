import type {SavedRaceRecord} from '@boatrace/contracts';
import type {ArtifactRepository} from '../artifacts/domain';
export type SavedVisibility = 'PRIVATE' | 'VISIBLE' | 'WITHDRAWN';
export type SavedRow = {id: string; record_kind: 'race' | 'prediction'; race_id: string; date: string;
  venue_code: string; venue_name: string | null; race_number: number; sha256: string; artifact_key: string;
  byte_length: number; state: 'RECEIVING' | 'REGISTERED' | 'HELD'; visibility: SavedVisibility; error: string | null};
export type SavedFilter = {kind?: 'race' | 'prediction'; date?: string; venue?: string; raceId?: string};
export interface SavedRaceRepository {
  get(id: string): Promise<SavedRow | null>;
  getMany(ids: string[]): Promise<SavedRow[]>;
  list(filter: SavedFilter, limit: number, cursor: string | null, visible: boolean): Promise<SavedRow[]>;
  groups(kind: 'date' | 'venue', date: string | null, limit: number, cursor: string | null): Promise<{value: string; name: string | null}[]>;
  reserve(record: SavedRaceRecord, sha: string, key: string, size: number): Promise<SavedRow>;
  state(id: string, value: SavedRow['state'], error?: string): Promise<void>;
  visibility(id: string, value: SavedVisibility): Promise<void>;
}
export type {ArtifactRepository};
