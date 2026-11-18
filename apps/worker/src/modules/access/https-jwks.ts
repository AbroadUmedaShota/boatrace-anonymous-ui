/** Bounded HTTPS transport. No JWT-controlled URL, PEM import or stale-on-error. */
import {strictJson} from './strict-json';
type Key = JsonWebKey & {kid: string};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const JWKS_TTL_MS = 60000;
export const JWKS_REFRESH_COOLDOWN_MS = 5000;
export const JWKS_TIMEOUT_MS = 2000;
export const JWKS_MAX_BYTES = 65536;
export function trustEndpoint(issuerValue?: string, endpointValue?: string) {
  if (!issuerValue || !endpointValue) throw new Error('JWKS_TRUST_CONFIGURATION_REQUIRED');
  const issuer = new URL(issuerValue), endpoint = new URL(endpointValue);
  if (issuer.protocol !== 'https:' || issuer.origin !== issuerValue || issuer.username || issuer.password ||
      issuer.pathname !== '/' || issuer.search || issuer.hash || issuer.port ||
      !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(issuer.hostname) ||
      endpoint.href !== issuerValue + '/cdn-cgi/access/certs') throw new Error('JWKS_TRUST_ENDPOINT_INVALID');
  return endpoint.href;
}
export function normalizePublishedJwks(text: string): {keys: Key[]} {
  const document = strictJson(text);
  if (!object(document) || Object.keys(document).some(k => !['keys', 'public_cert', 'public_certs'].includes(k)) ||
      !Array.isArray(document.keys) || !document.keys.length || document.keys.length > 5) throw new Error('INVALID_JWKS');
  const ids = new Set<string>();
  const keys = document.keys.map(value => {
    if (!object(value) || value.kty !== 'RSA' || value.alg !== 'RS256' || value.use !== 'sig' || value.e !== 'AQAB' ||
        typeof value.kid !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value.kid) || ids.has(value.kid) ||
        typeof value.n !== 'string' || !/^[A-Za-z0-9_-]{342,683}$/.test(value.n) ||
        Object.keys(value).some(k => !['kty', 'alg', 'use', 'e', 'n', 'kid', 'key_ops', 'ext'].includes(k)) ||
        value.key_ops !== undefined && JSON.stringify(value.key_ops) !== '["verify"]' || value.ext !== undefined && value.ext !== true)
      throw new Error('INVALID_JWKS_KEY');
    const bytes = Uint8Array.from(atob(value.n.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const canonical = btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    if (canonical !== value.n || bytes.length < 256 || bytes.length > 512 || bytes[0] === 0 ||
        bytes.length === 256 && bytes[0] < 128) throw new Error('INVALID_RSA_MODULUS');
    ids.add(value.kid); return {...value} as unknown as Key;
  });
  // Access publishes PEM certificate metadata alongside JWKs. Validate its
  // closed shape and kid links, then discard it: only n/e verify JWTs.
  const certificate = (value: unknown) => {
    if (!object(value) || Object.keys(value).sort().join() !== 'cert,kid' || !ids.has(String(value.kid)) ||
        typeof value.cert !== 'string' || value.cert.length > 16384 ||
        !/^-----BEGIN CERTIFICATE-----[\sA-Za-z0-9+/=]+-----END CERTIFICATE-----\s*$/.test(value.cert)) throw new Error('INVALID_JWKS_CERT_METADATA');
    return String(value.kid);
  };
  if (document.public_cert !== undefined) certificate(document.public_cert);
  if (document.public_certs !== undefined) {
    if (!Array.isArray(document.public_certs) || !document.public_certs.length || document.public_certs.length > 5) throw new Error('INVALID_JWKS_CERT_METADATA');
    const certIds = document.public_certs.map(certificate);
    if (new Set(certIds).size !== certIds.length) throw new Error('DUPLICATE_CERTIFICATE_KID');
  }
  return {keys};
}
export class JwksUnavailableError extends Error { constructor() { super('JWKS_UNAVAILABLE'); } }
type Entry = {keys?: Key[]; loaded: number; attempted: number; failed?: boolean; pending?: Promise<void>};
export class HttpsJwksResolver {
  private entries = new Map<string, Entry>();
  constructor(private transport: typeof fetch = (...args) => fetch(...args), private clock = () => performance.now()) {}
  private async refresh(url: string, entry: Entry) {
    if (entry.pending) return entry.pending;
    entry.attempted = this.clock();
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout>;
    const failed = new Promise<never>((_, reject) => { timeout = setTimeout(() => {
      controller.abort(); reject(new Error('JWKS_TIMEOUT'));
    }, JWKS_TIMEOUT_MS); });
    entry.pending = Promise.race([(async () => {
      const response = await this.transport(url, {method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: {Accept: 'application/json'}});
      if (response.status !== 200 || response.redirected || response.url && response.url !== url ||
          !/^application\/(?:json|jwk-set\+json)(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '')) throw new Error('JWKS_HTTP_REJECTED');
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > JWKS_MAX_BYTES)) throw new Error('JWKS_SIZE_LIMIT');
      if (!response.body) throw new Error('JWKS_BODY_REQUIRED');
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          size += chunk.value.byteLength; if (size > JWKS_MAX_BYTES) throw new Error('JWKS_SIZE_LIMIT'); chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const raw = new Uint8Array(size); let at = 0; for (const chunk of chunks) { raw.set(chunk, at); at += chunk.length; }
      const document = normalizePublishedJwks(new TextDecoder('utf-8', {fatal: true}).decode(raw));
      if (controller.signal.aborted) throw new Error('JWKS_TIMEOUT');
      entry.keys = document.keys; entry.loaded = this.clock(); entry.failed = false;
    })(), failed]).catch(() => { entry.keys = undefined; entry.failed = true; throw new JwksUnavailableError(); }).finally(() => {
      clearTimeout(timeout); entry.pending = undefined;
    });
    return entry.pending;
  }
  async key(issuer: string | undefined, endpoint: string | undefined, kid: string): Promise<Key> {
    const url = trustEndpoint(issuer, endpoint);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(kid)) throw new Error('INVALID_KEY_ID');
    let entry = this.entries.get(url);
    if (!entry) {
      if (this.entries.size >= 8) throw new Error('JWKS_CACHE_TARGET_LIMIT');
      entry = {loaded: -Infinity, attempted: -Infinity}; this.entries.set(url, entry);
    }
    const now = this.clock();
    if (now < entry.loaded || now < entry.attempted) { entry.keys = undefined; entry.attempted = -Infinity; }
    if (entry.pending) await entry.pending;
    if (!entry.keys || this.clock() - entry.loaded >= JWKS_TTL_MS) {
      if (this.clock() - entry.attempted < JWKS_REFRESH_COOLDOWN_MS) throw new JwksUnavailableError();
      await this.refresh(url, entry);
    } else if (!entry.keys.some(k => k.kid === kid) && this.clock() - entry.attempted >= JWKS_REFRESH_COOLDOWN_MS) {
      await this.refresh(url, entry);
    }
    const key = entry.keys?.find(k => k.kid === kid); if (!key) throw new Error('JWKS_UNKNOWN_KID'); return key;
  }
}
export const httpsJwks = new HttpsJwksResolver();
