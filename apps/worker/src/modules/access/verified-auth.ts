import {Problem} from '../evaluations/domain';
import {strictJson} from './strict-json';
import {httpsJwks, trustEndpoint, JwksUnavailableError} from './https-jwks';
export type Role = 'viewer' | 'admin' | 'registrar' | 'compute';
export type Authentication = 'LOCAL_SIGNED_TOKEN' | 'ACCESS_COMPATIBLE_LOCAL_FIXTURE' | 'ACCESS_HTTPS_JWKS_LOCAL_INTEGRATION' | 'ACCESS_PRODUCTION_CANDIDATE';
export type AuthBindings = {LOCAL_ONLY?: string; LOCAL_AUTH_SECRET?: string; AUTH_MODE?: string;
  PRODUCTION_ACCESS_ENABLED?:string; ACCESS_PUBLIC_ORIGIN?:string; ACCESS_ISSUER?: string; ACCESS_AUDIENCE?: string; ACCESS_JWKS_JSON?: string; ACCESS_JWKS_URL?: string; ACCESS_ROLE_BINDINGS_JSON?: string};
export type LocalIdentity = {role: Role; sub: string; iat: number; exp: number; aud: string | string[]; iss: string;
  authentication: Authentication; identity_kind: 'local' | 'user' | 'service'; local_only: boolean; actual_access_verified: false};
export type RoleBinding = {kind: 'user' | 'service'; subject: string; role: Role; enabled?: boolean};
const ROLES = ['viewer', 'admin', 'registrar', 'compute'];
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_BASE64');
  const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('NONCANONICAL_BASE64'); return bytes;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const subject = (value: unknown): value is string => typeof value === 'string' && /^[^\s\x00-\x1f\x7f]{1,256}$/.test(value);
function tokenParts(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(p => !p.length || p.length > 8192)) throw new Error('INVALID_TOKEN');
  const header = strictJson(new TextDecoder('utf-8', {fatal: true}).decode(decode(parts[0])));
  const payload = strictJson(new TextDecoder('utf-8', {fatal: true}).decode(decode(parts[1])));
  if (!record(header) || !record(payload)) throw new Error('INVALID_TOKEN_OBJECT'); return {parts, header, payload};
}
async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
export async function issueToken(secret: string, role: Role, ttl = 900, now = Math.floor(Date.now() / 1000)) {
  if (!ROLES.includes(role) || !Number.isInteger(ttl) || ttl < 1 || ttl > 3600) throw new Error('INVALID_TOKEN_PARAMETERS');
  const payload = {role, sub: 'local-operator', iat: now, exp: now + ttl, aud: 'boatrace-local', iss: 'boatrace-local-cli'};
  const head = encode(new TextEncoder().encode(JSON.stringify({alg: 'HS256', typ: 'JWT'})));
  const body = encode(new TextEncoder().encode(JSON.stringify(payload))), message = head + '.' + body;
  return message + '.' + encode(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(message))));
}
function times(payload: Record<string, unknown>, maxTtl: number) {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || Number(payload.iat) > now ||
      Number(payload.exp) <= now || Number(payload.exp) <= Number(payload.iat) || Number(payload.exp) - Number(payload.iat) > maxTtl ||
      payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || Number(payload.nbf) > now || Number(payload.nbf) >= Number(payload.exp)))
    throw new Error('INVALID_TOKEN_TIME'); return {iat: Number(payload.iat), exp: Number(payload.exp)};
}
export function validateAccessPins(env: AuthBindings, authorityOnly = false) {
  try {
    if (!env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE || !subject(env.ACCESS_AUDIENCE) || !env.ACCESS_JWKS_JSON || !env.ACCESS_ROLE_BINDINGS_JSON)
      throw new Error('MISSING_PINS');
    const issuer = new URL(env.ACCESS_ISSUER);
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || issuer.pathname !== '/' || issuer.search || issuer.hash || issuer.origin !== env.ACCESS_ISSUER)
      throw new Error('INVALID_ISSUER');
    const set = strictJson(env.ACCESS_JWKS_JSON), mapping = strictJson(env.ACCESS_ROLE_BINDINGS_JSON);
    if (!record(set) || Object.keys(set).join() !== 'keys' || !Array.isArray(set.keys) || !authorityOnly && !set.keys.length || set.keys.length > 5 ||
        !record(mapping) || mapping.schema_version !== 'boatrace-access-role-bindings/1' ||
        Object.keys(mapping).sort().join() !== 'bindings,schema_version' || !Array.isArray(mapping.bindings) || mapping.bindings.length > 500)
      throw new Error('INVALID_PIN_DOCUMENT');
    const ids = new Set<string>();
    const keys = set.keys.map(key => {
      if (!record(key) || key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig' || key.e !== 'AQAB' ||
          typeof key.kid !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(key.kid) || ids.has(key.kid) ||
          Object.keys(key).some(k => !['kty', 'alg', 'use', 'e', 'n', 'kid', 'key_ops', 'ext'].includes(k)) ||
          typeof key.n !== 'string' || decode(key.n).length < 256 || decode(key.n).length > 512 ||
          key.key_ops !== undefined && JSON.stringify(key.key_ops) !== '["verify"]' || key.ext !== undefined && key.ext !== true)
        throw new Error('INVALID_PINNED_KEY'); ids.add(key.kid); return key;
    });
    const identities = new Set<string>();
    const bindings = mapping.bindings.map(binding => {
      if (!record(binding) || !['user', 'service'].includes(String(binding.kind)) || !subject(binding.subject) ||
          !ROLES.includes(String(binding.role)) || binding.kind === 'service' && binding.role === 'admin' ||
          binding.enabled !== undefined && typeof binding.enabled !== 'boolean' ||
          Object.keys(binding).some(k => !['kind', 'subject', 'role', 'enabled'].includes(k))) throw new Error('INVALID_ROLE_BINDING');
      const key = binding.kind + ':' + binding.subject; if (identities.has(key)) throw new Error('AMBIGUOUS_ROLE_BINDING'); identities.add(key);
      return binding as unknown as RoleBinding;
    });
    return {issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUDIENCE, keys, bindings};
  } catch { throw new Problem(403, 'ACCESS_PIN_CONFIGURATION_INVALID'); }
}
export function validateHttpsAuthority(env: AuthBindings) {
  try {
    trustEndpoint(env.ACCESS_ISSUER, env.ACCESS_JWKS_URL);
    const authority = validateAccessPins({...env, ACCESS_JWKS_JSON: '{"keys":[]}'}, true);
    if (authority.bindings.some(binding => binding.kind === 'service' ? binding.role !== 'registrar' :
      !['viewer', 'admin'].includes(binding.role))) throw new Error('INVALID_HTTPS_SUBJECT_ROLE');
    return authority;
  } catch { throw new Problem(403, 'ACCESS_PIN_CONFIGURATION_INVALID'); }
}
function credential(request: Request, access: boolean) {
  const authorization = request.headers.get('Authorization'), assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (assertion && (!access || authorization)) throw new Problem(401, 'AMBIGUOUS_CREDENTIALS');
  const token = assertion ?? (authorization && /^Bearer [A-Za-z0-9_.-]+$/.test(authorization) ? authorization.slice(7) : null);
  if (!token || !/^[A-Za-z0-9_.-]+$/.test(token)) throw new Problem(401, 'TOKEN_REQUIRED'); return token;
}
export function sessionInfo(identity: LocalIdentity) {
  return {role: identity.role, authentication: identity.authentication, local_only: identity.local_only, actual_access_verified: false as const};
}
export async function authenticate(request: Request, env: AuthBindings): Promise<LocalIdentity> {
  const url = new URL(request.url);
  if (env.LOCAL_ONLY !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Problem(403, 'LOCAL_ONLY');
  if (request.headers.has('Host')) {
    const host = request.headers.get('Host')!;
    try {
      const parsed = new URL('http://' + host);
      if (parsed.host !== host || parsed.hostname !== url.hostname || parsed.username || parsed.password || parsed.pathname !== '/') throw new Error();
    } catch { throw new Problem(403, 'INVALID_HOST'); }
  }
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin && origin !== 'http://127.0.0.1:5173') throw new Problem(403, 'INVALID_ORIGIN');
  const mode = env.AUTH_MODE ?? 'LOCAL_HS256';
  if (!['LOCAL_HS256', 'ACCESS_LOCAL_FIXTURE_RS256', 'ACCESS_HTTPS_JWKS_RS256'].includes(mode)) throw new Problem(403, 'AUTH_MODE_NOT_ENABLED');
  if (mode === 'ACCESS_HTTPS_JWKS_RS256' && origin && origin !== url.origin) throw new Problem(403, 'INVALID_ORIGIN');
  if (mode === 'LOCAL_HS256') {
    if (!env.LOCAL_AUTH_SECRET || env.LOCAL_AUTH_SECRET.length < 32) throw new Problem(403, 'LOCAL_AUTH_NOT_CONFIGURED');
    const token = credential(request, false);
    try {
      const {parts, header, payload} = tokenParts(token);
      if (header.alg !== 'HS256' || header.typ !== 'JWT' || Object.keys(header).sort().join() !== 'alg,typ') throw new Error('INVALID_ALGORITHM');
      if (!await crypto.subtle.verify('HMAC', await hmacKey(env.LOCAL_AUTH_SECRET), decode(parts[2]) as BufferSource,
          new TextEncoder().encode(parts[0] + '.' + parts[1]))) throw new Error('INVALID_SIGNATURE');
      if (!ROLES.includes(String(payload.role)) || payload.aud !== 'boatrace-local' || payload.iss !== 'boatrace-local-cli' || payload.sub !== 'local-operator')
        throw new Error('INVALID_LOCAL_CLAIMS');
      return {role: payload.role as Role, sub: 'local-operator', ...times(payload, 3600), aud: 'boatrace-local', iss: 'boatrace-local-cli',
        authentication: 'LOCAL_SIGNED_TOKEN', identity_kind: 'local', local_only: true, actual_access_verified: false};
    } catch { throw new Problem(401, 'INVALID_OR_EXPIRED_TOKEN'); }
  }
  const pins = mode === 'ACCESS_HTTPS_JWKS_RS256' ? validateHttpsAuthority(env) : validateAccessPins(env), token = credential(request, true);
  return verifyAccessIdentity(token,env,pins,mode as 'ACCESS_HTTPS_JWKS_RS256'|'ACCESS_LOCAL_FIXTURE_RS256');
}

export async function verifyAccessIdentity(token:string,env:AuthBindings,pins:ReturnType<typeof validateAccessPins>,mode:'ACCESS_HTTPS_JWKS_RS256'|'ACCESS_LOCAL_FIXTURE_RS256'):Promise<LocalIdentity>{
  let subjectId: string, kind: 'user' | 'service', timing: {iat: number; exp: number}, audience: string[];
  try {
    const {parts, header, payload} = tokenParts(token);
    if (header.alg !== 'RS256' || header.typ !== undefined && header.typ !== 'JWT' || typeof header.kid !== 'string' ||
        Object.keys(header).some(k => !['alg', 'typ', 'kid'].includes(k))) throw new Error('INVALID_ALGORITHM');
    const key = mode === 'ACCESS_HTTPS_JWKS_RS256' ? await httpsJwks.key(env.ACCESS_ISSUER, env.ACCESS_JWKS_URL, header.kid) :
      pins.keys.find(key => key.kid === header.kid); if (!key) throw new Error('UNKNOWN_KEY');
    if (mode === 'ACCESS_HTTPS_JWKS_RS256') validateAccessPins({...env, ACCESS_JWKS_JSON: JSON.stringify({keys: [key]})});
    const imported = await crypto.subtle.importKey('jwk', key as JsonWebKey, {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'}, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, decode(parts[2]) as BufferSource,
        new TextEncoder().encode(parts[0] + '.' + parts[1]))) throw new Error('INVALID_SIGNATURE');
    audience = typeof payload.aud === 'string' ? [payload.aud] : Array.isArray(payload.aud) && payload.aud.every(a => typeof a === 'string') ? payload.aud : [];
    if (!audience.length || new Set(audience).size !== audience.length || !audience.includes(pins.audience) || payload.iss !== pins.issuer || payload.type !== 'app')
      throw new Error('WRONG_ISSUER_OR_AUDIENCE'); timing = times(payload, 86400);
    if (subject(payload.sub) && payload.common_name === undefined) { kind = 'user'; subjectId = payload.sub; }
    else if (payload.sub === '' && subject(payload.common_name)) { kind = 'service'; subjectId = payload.common_name; }
    else throw new Error('AMBIGUOUS_SUBJECT');
  } catch (error) {
    if (error instanceof JwksUnavailableError) throw new Problem(503, 'JWKS_UNAVAILABLE');
    throw new Problem(401, 'INVALID_OR_EXPIRED_ACCESS_TOKEN');
  }
  const binding = pins.bindings.find(binding => binding.kind === kind && binding.subject === subjectId && binding.enabled !== false);
  if (!binding) throw new Problem(403, 'SUBJECT_NOT_AUTHORIZED');
  return {role: binding.role, sub: subjectId, ...timing, aud: audience, iss: pins.issuer,
    authentication: mode === 'ACCESS_HTTPS_JWKS_RS256' ? 'ACCESS_HTTPS_JWKS_LOCAL_INTEGRATION' : 'ACCESS_COMPATIBLE_LOCAL_FIXTURE',
    identity_kind: kind, local_only: true, actual_access_verified: false};
}
