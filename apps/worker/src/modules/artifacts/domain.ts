export interface ArtifactRepository {
  get(key: string): Promise<Uint8Array | null>;
  stage(key: string, bytes: Uint8Array): Promise<void>;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)))
    .map(v => v.toString(16).padStart(2, '0')).join('');
}
