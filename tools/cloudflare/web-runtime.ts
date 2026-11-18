import {createHash} from 'node:crypto';
import {createServer, type IncomingMessage} from 'node:http';
import {readFile, readdir, lstat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {privateState, startRuntime, type RuntimeOptions} from './runtime';
import {acquireOperationLock} from './operation-lock';
import {authenticate} from '../../apps/worker/src/modules/access/auth';
import {Problem} from '../../apps/worker/src/modules/evaluations/domain';
// @ts-expect-error generator is a Node-only ESM build helper
import {generateContract} from './generate-contract.mjs';
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WEB = path.join(REPO, 'apps/web/dist');
export const BUILD_MANIFEST = 'phase2-build-manifest.json';
export const STOP_ROUTE = '/_local/control/stop';
export const hash = (raw: Uint8Array | string) => createHash('sha256').update(raw).digest('hex');
export async function inventory(root: string, excluded = new Set<string>()) {
  const result: Record<string, {bytes: number; sha256: string}> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      if (excluded.has(entry.name) || ['node_modules', '.git', 'dist'].includes(entry.name)) continue;
      const item = path.join(directory, entry.name), info = await lstat(item);
      if (info.isSymbolicLink()) throw new Error('SOURCE_LINK_FORBIDDEN');
      if (info.isDirectory()) await visit(item);
      else if (info.isFile()) { const raw = await readFile(item); result[path.relative(root, item).split(path.sep).join('/')] = {bytes: raw.length, sha256: hash(raw)}; }
      else throw new Error('REGULAR_SOURCE_FILE_REQUIRED');
    }
  }
  await visit(root); return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export async function sourceManifest() {
  const files: Record<string, {bytes: number; sha256: string}> = {};
  for (const relative of ['apps/web/src', 'apps/worker/src', 'packages/contracts', 'tools/cloudflare']) {
    const entries = await inventory(path.join(REPO, relative));
    for (const [name, value] of Object.entries(entries)) if (!name.endsWith('.test.ts')) files[relative + '/' + name] = value;
  }
  for (const relative of ['package.json', 'package-lock.json', 'apps/web/package.json', 'apps/web/index.html', 'apps/web/tsconfig.json', 'apps/web/vite.config.ts',
    'packages/cloud-export/cloud-view.schema.json']) {
    const raw = await readFile(path.join(REPO, relative)); files[relative] = {bytes: raw.length, sha256: hash(raw)};
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
export function frontendAuthMode(){const value=process.env.VITE_BOAT_AUTH_MODE;if(value!==undefined&&value!==''&&value!=='local'&&value!=='cloudflare-access')throw new Error('INVALID_FRONTEND_AUTH_MODE');return value==='cloudflare-access'?'CLOUDFLARE_ACCESS':'LOCAL_MANUAL_TOKEN';}
export async function buildWeb() {
  const authMode=frontendAuthMode();
  await generateContract();
  const before = await sourceManifest();
  await new Promise<void>((resolve, reject) => {
    // Invoke the existing local toolchain directly, without npm install/network.
    const child = spawn(process.execPath, [path.join(REPO, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.config.ts'],
      {cwd: path.join(REPO, 'apps/web'), stdio: 'inherit', windowsHide: true});
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('WEB_BUILD_FAILED')));
  });
  const after = await sourceManifest();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    const names = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
      .filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
    throw new Error('SOURCE_CHANGED_DURING_BUILD: ' + names.join(','));
  }
  const assets = await inventory(WEB, new Set([BUILD_MANIFEST]));
  if (!assets['index.html']) throw new Error('WEB_INDEX_MISSING');
  if(frontendAuthMode()!==authMode)throw new Error('AUTH_MODE_CHANGED_DURING_BUILD');
  const manifest = {schema_version: 'boatrace-phase2-build/1', auth_mode:authMode, node: process.version, sources: after, assets};
  await writeFile(path.join(WEB, BUILD_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
export async function verifiedAssets() {
  const manifest = JSON.parse(await readFile(path.join(WEB, BUILD_MANIFEST), 'utf8'));
  if ((manifest.auth_mode??'LOCAL_MANUAL_TOKEN')!==frontendAuthMode()||manifest.schema_version !== 'boatrace-phase2-build/1' || JSON.stringify(manifest.sources) !== JSON.stringify(await sourceManifest()) ||
      JSON.stringify(manifest.assets) !== JSON.stringify(await inventory(WEB, new Set([BUILD_MANIFEST])))) throw new Error('WEB_BUILD_MANIFEST_MISMATCH: run build-web');
  const assets = new Map<string, Buffer>();
  for (const name of Object.keys(manifest.assets)) {
    if (name.includes('\\') || name.split('/').includes('..') || path.isAbsolute(name)) throw new Error('INVALID_ASSET_MANIFEST_PATH');
    assets.set('/' + name, await readFile(path.join(WEB, name)));
  }
  return {assets, manifest};
}
const contentTypes: Record<string, string> = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'};
async function requestBody(request: IncomingMessage) {
  const pathname=new URL(request.url??'/', 'http://127.0.0.1').pathname;
  const limit=/^\/api\/internal\/prediction-jobs\/[A-Za-z0-9_-]+\/(input-artifact|source-artifacts\/(racelist|beforeinfo|odds3t))$/.test(pathname)?1024*1024:256*1024;
  let total = 0; const chunks: Buffer[] = [];
  for await (const item of request) { const chunk = Buffer.from(item); total += chunk.length; if (total > limit) throw new Error('BODY_LIMIT'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
export async function startWebRuntime(state: string, port = 8787, options: RuntimeOptions = {}) {
  if(frontendAuthMode()!=='LOCAL_MANUAL_TOKEN')throw new Error('PRODUCTION_ASSETS_NOT_LOCAL_RUNTIME');
  const release = await acquireOperationLock(state, 'launch');
  let runtime: Awaited<ReturnType<typeof startRuntime>> | undefined;
  try {
    const {assets, manifest} = await verifiedAssets();
    const auth = (await readFile(await privateState(path.join(state, 'auth.key')), 'utf8')).trim();
    runtime = await startRuntime(state, 0, auth, options);
    let origin = '';
    let dispose: () => Promise<void>;
    let closeResolved!: () => void, closeRejected!: (error: unknown) => void;
    const closed = new Promise<void>((resolve, reject) => { closeResolved = resolve; closeRejected = reject; });
    const server = createServer(async (request, response) => {
      try {
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
        const host = new URL(origin).host;
        if (request.headers.host !== host || request.rawHeaders.filter((_, i) => i % 2 === 0).filter(x => x.toLowerCase() === 'host').length !== 1 ||
            request.headers.origin && request.headers.origin !== origin) { response.writeHead(403).end('LOCAL_ORIGIN_REQUIRED'); return; }
        const raw = request.url ?? '/';
        if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) { response.writeHead(400).end(); return; }
        const pathname = decodeURIComponent(raw.split('?')[0]);
        if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part === '.')) { response.writeHead(400).end(); return; }
        if (pathname === STOP_ROUTE) {
          if (request.method !== 'POST' || raw.includes('?')) { response.writeHead(404).end(); return; }
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
          const identity = await authenticate(new Request(origin + STOP_ROUTE, {method: 'POST', headers}),
            {LOCAL_ONLY: 'true', LOCAL_AUTH_SECRET: auth, AUTH_MODE: 'LOCAL_HS256'});
          if (identity.role !== 'admin') throw new Problem(403, 'FORBIDDEN_ROLE');
          if (headers.get('Content-Type')?.split(';')[0] !== 'application/json') throw new Problem(415, 'JSON_REQUIRED');
          const value = JSON.parse((await requestBody(request)).toString('utf8'));
          if (!value || Object.keys(value).sort().join() !== 'generation,pid,state_dir' ||
              value.generation !== release.owner.generation || value.pid !== release.owner.pid ||
              value.state_dir !== release.owner.state_dir) throw new Problem(409, 'CONTROL_GENERATION_MISMATCH');
          response.setHeader('Connection', 'close');
          response.setHeader('Content-Type', 'application/json');
          response.once('finish', () => { void dispose().catch(() => {}); });
          response.writeHead(200).end(JSON.stringify({status: 'STOPPING', generation: release.owner.generation,
            pid: release.owner.pid, state_dir: release.owner.state_dir}));
          return;
        }
        if (pathname.startsWith('/api/')) {
          const headers = new Headers();
          for (const [key, value] of Object.entries(request.headers)) if (value && !['host', 'connection', 'content-length', 'transfer-encoding'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value);
          const body = ['GET', 'HEAD'].includes(request.method ?? '') ? undefined : await requestBody(request);
          // Preserve the checked public origin; never turn a foreign Host into localhost.
          const result = await runtime!.mf.dispatchFetch(origin + raw, {method: request.method, headers: Object.fromEntries(headers), body});
          const responseBody=Buffer.from(await result.arrayBuffer());
          response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(responseBody); return;
        }
        response.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        if (!['GET', 'HEAD'].includes(request.method ?? '') || raw.includes('?')) { response.writeHead(404).end(); return; }
        const key = pathname === '/' ? '/index.html' : pathname, asset = assets.get(key);
        if (!asset) { response.writeHead(404).end(); return; }
        response.writeHead(200, {'Content-Type': contentTypes[path.extname(key)] ?? 'application/octet-stream', 'Content-Length': asset.length});
        response.end(request.method === 'HEAD' ? undefined : asset);
      } catch (error) { if(response.headersSent){response.destroy();return;}response.writeHead(error instanceof Problem ? error.status : (error as Error).message === 'BODY_LIMIT' ? 413 : 400).end('REQUEST_REJECTED'); }
    });
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('LOCAL_LISTEN_FAILED');
    origin = 'http://127.0.0.1:' + address.port;
    let closing: Promise<void> | undefined;
    dispose = () => closing ??= (async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        await runtime!.mf.dispose();
        await release();
        closeResolved();
      } catch (error) { closeRejected(error); throw error; }
    })();
    await release.publishControl(origin);
    return {url: origin, manifest, outboundCalls: runtime.outboundCalls, jwksFixtureCalls: runtime.jwksFixtureCalls,
      realOutboundCalls: runtime.realOutboundCalls, dispose, closed};
  } catch (error) { try { await runtime?.mf.dispose(); } finally { await release(); } throw error; }
}
