import {assertCloudView, parseJsonLexemes, type CloudView, type CloudProvenance} from '@boatrace/contracts';
import {sha256, Problem} from './domain';
export async function parseCloudView(raw: Uint8Array): Promise<{artifact: CloudView; summaryText: string}> {
  if (!raw.length || raw.length > 256 * 1024) throw new Problem(413, 'CLOUD_ARTIFACT_SIZE_LIMIT');
  let parsed: ReturnType<typeof parseJsonLexemes>;
  try {
    parsed = parseJsonLexemes(new TextDecoder('utf-8', {fatal: true}).decode(raw));
    assertCloudView(parsed.value);
  } catch { throw new Problem(400, 'INVALID_CLOUD_VIEW_SCHEMA'); }
  const artifact = parsed.value as CloudView;
  const summaryText = parsed.lexemes.summary;
  if (!summaryText || await sha256(new TextEncoder().encode(summaryText)) !== artifact.references.summary_sha256 ||
      artifact.evaluation_id !== 'eval-' + artifact.references.summary_sha256 ||
      artifact.references.model_sha256 !== artifact.summary.model_sha256)
    throw new Problem(400, 'CLOUD_SUMMARY_HASH_OR_ID_MISMATCH');
  return {artifact, summaryText};
}
export function cloudProvenance(artifact: CloudView, summaryText: string): CloudProvenance {
  return {schema_version: 'boatrace-cloud-view-provenance/1', references: artifact.references,
    summary_json_utf8: summaryText, release_allowed: false, legal_approval: 'UNKNOWN', notice: 'LOCAL_CANDIDATE_NOT_RELEASED'};
}
