import type {ComputeArtifactRepository,ComputeArtifactKind} from '../../modules/prediction-jobs/domain';
import {Problem} from '../../modules/evaluations/domain';
export const COMPUTE_LIMITS={model:16*1024*1024,input:1024*1024,source:1024*1024,result:256*1024};
export class R2ComputeArtifacts implements ComputeArtifactRepository {
 constructor(private bucket:R2Bucket){}
 async read(key:string,kind:ComputeArtifactKind){const object=await this.bucket.get(key);if(!object)return null;if(object.size>COMPUTE_LIMITS[kind])throw new Problem(503,'COMPUTE_ARTIFACT_SIZE_LIMIT');return new Uint8Array(await object.arrayBuffer());}
 get(key:string){return this.read(key,'result');}
 async stage(key:string,bytes:Uint8Array){await this.bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}});}
}
