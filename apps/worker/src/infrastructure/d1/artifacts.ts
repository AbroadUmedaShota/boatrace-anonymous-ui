import type {ArtifactRepository} from '../../modules/artifacts/domain';
import {Problem} from '../../modules/evaluations/domain';
import {D1ComputeArtifacts} from './compute-artifacts';

// Keep the shared read contract equal to R2Artifacts. The larger compute/model
// limits belong to PREDICTION_ARTIFACT_STORE, not this repository.
export const D1_ARTIFACT_MAX_BYTES = 256 * 1024;
export class D1Artifacts implements ArtifactRepository {
  private artifacts: D1ComputeArtifacts;
  constructor(db: D1Database) { this.artifacts = new D1ComputeArtifacts(db); }
  async get(key: string) {
    try { return await this.artifacts.get(key); }
    catch (error) {
      if (error instanceof Problem && error.code === 'COMPUTE_ARTIFACT_SIZE_LIMIT')
        throw new Problem(503, 'ARTIFACT_SIZE_LIMIT');
      throw error;
    }
  }
  stage(key: string, bytes: Uint8Array) {
    if (bytes instanceof Uint8Array && bytes.length > D1_ARTIFACT_MAX_BYTES)
      throw new Problem(413, 'ARTIFACT_SIZE_LIMIT');
    return this.artifacts.stage(key, bytes);
  }
}
