import type {ArtifactRepository} from '../../modules/evaluations/domain';
import {Problem} from '../../modules/evaluations/domain';
export class R2Artifacts implements ArtifactRepository {
  constructor(private bucket: R2Bucket) {}
  async get(key: string) {
    const object = await this.bucket.get(key);
    if (!object) return null;
    if (object.size > 256 * 1024) throw new Problem(503, 'ARTIFACT_SIZE_LIMIT');
    return new Uint8Array(await object.arrayBuffer());
  }
  async stage(key: string, bytes: Uint8Array) {
    await this.bucket.put(key, bytes, {onlyIf: {etagDoesNotMatch: '*'}, httpMetadata: {contentType: 'application/json'}});
  }
}
