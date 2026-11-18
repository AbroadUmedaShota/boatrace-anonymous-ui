import {raceContextRoutes} from './modules/race-context/routes';
import {Hono} from 'hono';
import {compose, type Bindings} from './composition';
import {authenticateApplication, sessionInfo, type LocalIdentity} from './modules/access/auth';
import {Problem, type Visibility} from './modules/evaluations/domain';
import {MAX_TRANSFER_BYTES} from './modules/evaluations/service';
import {savedRaceRoutes} from './modules/saved-races/routes';

import {predictionJobRoutes} from './modules/prediction-jobs/routes';
const app = new Hono<{Bindings: Bindings; Variables: {identity: LocalIdentity}}>();
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  c.set('identity', await authenticateApplication(c.req.raw, c.env));
  await next();
});
app.onError(async (error, c) => {
  // Drain bounded rejected uploads so workerd can complete the early response.
  // This neither parses nor registers the rejected artifact.
  if (/^\/api\/internal\/prediction-jobs\/[^/]+\/(input-artifact|source-artifacts\/[^/]+)$/.test(c.req.path) && !c.req.raw.bodyUsed && c.req.raw.body) {
    const reader=c.req.raw.body.getReader();let size=0;
    try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader.cancel();break;}}}catch{}
  }
  const problem = error instanceof Problem ? error : new Problem(503, 'STORAGE_UNAVAILABLE');
  return c.json({error: {code: problem.code}}, problem.status as 400);
});
function role(identity: LocalIdentity, required: 'admin' | 'registrar') {
  if (identity.role !== required) throw new Problem(403, 'FORBIDDEN_ROLE');
}
async function body(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Problem(415, 'JSON_REQUIRED');
  if (!request.body) throw new Problem(400, 'BODY_REQUIRED');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const result = await reader.read(); if (result.done) break;
    size += result.value.length;
    if (size > MAX_TRANSFER_BYTES) { await reader.cancel(); throw new Problem(413, 'TRANSFER_SIZE_LIMIT'); }
    chunks.push(result.value);
  }
  const value = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.length; }
  return value;
}
function noQuery(url: string) { if (new URL(url).search) throw new Problem(400, 'QUERY_NOT_ALLOWED'); }
function viewer(identity: LocalIdentity) {
  if (!['viewer', 'admin'].includes(identity.role)) throw new Problem(403, 'FORBIDDEN_ROLE');
}
function pagination(url: string): {limit: number; cursor: string | null} {
  const params = new URL(url).searchParams;
  if ([...params.keys()].some(key => !['limit', 'cursor'].includes(key)) ||
      params.getAll('limit').length > 1 || params.getAll('cursor').length > 1)
    throw new Problem(400, 'INVALID_PAGINATION');
  const limit = params.get('limit') ?? '20';
  const cursor = params.get('cursor');
  if (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > 50 ||
      (cursor !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(cursor)))
    throw new Problem(400, 'INVALID_PAGINATION');
  return {limit: Number(limit), cursor};
}
app.get('/api/session', c => {
  noQuery(c.req.url);
  return c.json(sessionInfo(c.get('identity')));
});
app.get('/api/evaluations/latest', async c => {
  noQuery(c.req.url);
  viewer(c.get('identity'));
  return c.json(await compose(c.env).latest());
});
app.get('/api/evaluations', async c => {
  viewer(c.get('identity'));
  const {limit, cursor} = pagination(c.req.url);
  return c.json(await compose(c.env).list(limit, cursor));
});
app.get('/api/evaluations/:id', async c => {
  noQuery(c.req.url); viewer(c.get('identity'));
  return c.json(await compose(c.env).detail(c.req.param('id'), c.get('identity').role === 'admin'));
});
app.post('/api/evaluations', async c => {
  noQuery(c.req.url); role(c.get('identity'), 'registrar');
  return c.json(await compose(c.env).register(await body(c.req.raw)));
});
app.post('/api/cloud-evaluations', async c => {
  noQuery(c.req.url); role(c.get('identity'), 'registrar');
  return c.json(await compose(c.env).registerCloud(await body(c.req.raw)));
});
app.get('/api/admin/evaluations', async c => {
  role(c.get('identity'), 'admin');
  const {limit, cursor} = pagination(c.req.url);
  return c.json(await compose(c.env).list(limit, cursor, true));
});
app.get('/api/admin/evaluations/:id', async c => {
  noQuery(c.req.url); role(c.get('identity'), 'admin'); return c.json(await compose(c.env).inspect(c.req.param('id')));
});
app.post('/api/admin/evaluations/:id/visibility', async c => {
  noQuery(c.req.url); role(c.get('identity'), 'admin');
  let value: {visibility: Visibility};
  try { value = JSON.parse(new TextDecoder().decode(await body(c.req.raw))); } catch { throw new Problem(400, 'INVALID_BODY'); }
  if (!value || Object.keys(value).join() !== 'visibility') throw new Problem(400, 'INVALID_BODY');
  return c.json(await compose(c.env).visibility(c.req.param('id'), value.visibility));
});
app.post('/api/admin/latest', async c => {
  noQuery(c.req.url); role(c.get('identity'), 'admin');
  let value: {evaluation_id: string};
  try { value = JSON.parse(new TextDecoder().decode(await body(c.req.raw))); } catch { throw new Problem(400, 'INVALID_BODY'); }
  if (!value || Object.keys(value).join() !== 'evaluation_id' || typeof value.evaluation_id !== 'string') throw new Problem(400, 'INVALID_BODY');
  return c.json(await compose(c.env).setLatest(value.evaluation_id));
});
app.route('/', raceContextRoutes);
app.route('/', savedRaceRoutes);
app.route('/', predictionJobRoutes);
app.notFound(async c => {
  if(c.env.AUTH_MODE==='ACCESS_PRODUCTION_RS256'&&c.env.ASSETS&&['GET','HEAD'].includes(c.req.method)&&c.req.path!=='/api'&&!c.req.path.startsWith('/api/')){
    viewer(c.get('identity'));
    const manifestResponse=await c.env.ASSETS.fetch(new Request(new URL('/phase2-build-manifest.json',c.req.url)));
    if(!manifestResponse.ok)throw new Problem(503,'PRODUCTION_ASSET_MANIFEST_REQUIRED');
    const manifestText=await manifestResponse.text();if(manifestText.length>262144)throw new Problem(503,'PRODUCTION_ASSET_MANIFEST_INVALID');
    let manifest:{auth_mode?:string};try{manifest=JSON.parse(manifestText);}catch{throw new Problem(503,'PRODUCTION_ASSET_MANIFEST_INVALID');}
    if(manifest.auth_mode!=='CLOUDFLARE_ACCESS')throw new Problem(503,'PRODUCTION_ASSET_AUTH_MODE_MISMATCH');
    const asset=await c.env.ASSETS.fetch(c.req.raw),headers=new Headers(asset.headers);
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'");
    headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');
    return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
  }
  return c.json({error:{code:'NOT_FOUND'}},404);
});
export default app;
