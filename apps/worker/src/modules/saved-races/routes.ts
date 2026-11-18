import {Hono} from 'hono';
import {composeSavedRaces, type Bindings} from '../../composition';
import type {LocalIdentity} from '../access/auth';
import {Problem} from '../evaluations/domain';
import type {SavedVisibility} from './domain';
import {MAX_SAVED_BYTES, savedId} from './service';
import {parseJsonLexemes} from '@boatrace/contracts';
type Context = {Bindings: Bindings; Variables: {identity: LocalIdentity}};
export const savedRaceRoutes = new Hono<Context>();
function authorize(identity: LocalIdentity, role: 'read' | 'admin' | 'registrar') {
  if (role === 'read' ? !['viewer','admin'].includes(identity.role) : identity.role !== role) throw new Problem(403, 'FORBIDDEN_ROLE');
}
function query(url: string, allowed: string[], required: string[] = []) {
  const p = new URL(url).searchParams;
  if ([...p.keys()].some(k => !allowed.includes(k) || p.getAll(k).length !== 1) || required.some(k => !p.get(k))) throw new Problem(400, 'INVALID_SAVED_QUERY');
  const limit = p.get('limit') ?? '20', cursor = p.get('cursor');
  if (!/^[1-9][0-9]?$/.test(limit) || Number(limit) > 50 || (cursor !== null && !/^[A-Za-z0-9_-]{1,160}$/.test(cursor))) throw new Problem(400, 'INVALID_PAGINATION');
  return {p, limit: Number(limit), cursor};
}
function date(value: string) {
  const stamp = new Date(value + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0,10) !== value) throw new Problem(400, 'INVALID_DATE');
  return value;
}
async function bytes(request: Request) {
  if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Problem(415, 'JSON_REQUIRED');
  if (!request.body) throw new Problem(400, 'BODY_REQUIRED');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  while (true) { const r = await reader.read(); if (r.done) break; size += r.value.length;
    if (size > MAX_SAVED_BYTES) { await reader.cancel(); throw new Problem(413, 'TRANSFER_SIZE_LIMIT'); } chunks.push(r.value); }
  const raw = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { raw.set(chunk,offset); offset += chunk.length; } return raw;
}
savedRaceRoutes.get('/api/saved-races/dates', async c => {
  authorize(c.get('identity'),'read'); const {limit,cursor} = query(c.req.url,['limit','cursor']);
  if (cursor) date(cursor);
  return c.json(await composeSavedRaces(c.env).groups('date', null, limit, cursor));
});
savedRaceRoutes.get('/api/saved-races/venues', async c => {
  authorize(c.get('identity'),'read'); const {p,limit,cursor} = query(c.req.url,['date','limit','cursor'],['date']);
  if (cursor && !/^\d{2}$/.test(cursor)) throw new Problem(400, 'INVALID_PAGINATION');
  return c.json(await composeSavedRaces(c.env).groups('venue', date(p.get('date')!), limit, cursor));
});
savedRaceRoutes.get('/api/saved-races/races', async c => {
  authorize(c.get('identity'),'read'); const {p,limit,cursor} = query(c.req.url,['date','venue','limit','cursor'],['date','venue']);
  if (!/^\d{2}$/.test(p.get('venue')!)) throw new Problem(400, 'INVALID_VENUE');
  return c.json(await composeSavedRaces(c.env).list({kind:'race',date:date(p.get('date')!),venue:p.get('venue')!},limit,cursor));
});
savedRaceRoutes.get('/api/saved-races/predictions', async c => {
  authorize(c.get('identity'),'read'); const {p,limit,cursor} = query(c.req.url,['raceId','limit','cursor'],['raceId']);
  if (!/^race-\d{8}-\d{2}-\d{2}$/.test(p.get('raceId')!)) throw new Problem(400, 'INVALID_RACE_ID');
  return c.json(await composeSavedRaces(c.env).list({kind:'prediction',raceId:p.get('raceId')!},limit,cursor));
});
for (const [path,kind] of [['races','race'],['predictions','prediction']] as const) savedRaceRoutes.get('/api/saved-races/' + path + '/:id', async c => {
  authorize(c.get('identity'),'read'); query(c.req.url,[]);
  return c.json(await composeSavedRaces(c.env).detail(savedId(c.req.param('id') ?? ''),kind));
});
savedRaceRoutes.post('/api/saved-races/import', async c => {
  authorize(c.get('identity'),'registrar'); query(c.req.url,[]);
  return c.json(await composeSavedRaces(c.env).register(await bytes(c.req.raw)));
});
savedRaceRoutes.get('/api/admin/saved-races/:id', async c => {
  authorize(c.get('identity'),'admin'); query(c.req.url,[]);
  return c.json(await composeSavedRaces(c.env).inspect(c.req.param('id')));
});
savedRaceRoutes.post('/api/admin/saved-races/:id/visibility', async c => {
  authorize(c.get('identity'),'admin'); query(c.req.url,[]);
  let value: {visibility: SavedVisibility};
  try { value = parseJsonLexemes(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(c.req.raw))).value as {visibility: SavedVisibility}; }
  catch { throw new Problem(400,'INVALID_BODY'); }
  if (!value || Object.keys(value).join() !== 'visibility') throw new Problem(400,'INVALID_BODY');
  return c.json(await composeSavedRaces(c.env).visibility(c.req.param('id'),value.visibility));
});
