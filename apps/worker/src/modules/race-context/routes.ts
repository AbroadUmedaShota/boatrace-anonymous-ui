import {Hono} from 'hono';
import {composeArtifacts,type Bindings} from '../../composition';
import type {LocalIdentity} from '../access/auth';
import {Problem} from '../evaluations/domain';
import {RaceContextService} from './service';
import {D1RaceContexts} from '../../infrastructure/d1/race-context';
import {D1SavedRaces} from '../../infrastructure/d1/saved-races';
export const raceContextRoutes=new Hono<{Bindings:Bindings;Variables:{identity:LocalIdentity}}>();
const service=(env:Bindings)=>new RaceContextService(new D1RaceContexts(env.DB),new D1SavedRaces(env.DB),composeArtifacts(env));
raceContextRoutes.use('/api/race-context/*',async(c,next)=>{if(new URL(c.req.url).search)throw new Problem(400,'QUERY_NOT_ALLOWED');await next();});
raceContextRoutes.get('/api/race-context/:id',async c=>{if(!['viewer','admin'].includes(c.get('identity').role))throw new Problem(403,'FORBIDDEN_ROLE');return c.json(await service(c.env).read(c.req.param('id')));});
raceContextRoutes.post('/api/race-context/import',async c=>{
 if(c.get('identity').role!=='registrar')throw new Problem(403,'FORBIDDEN_ROLE');
 if(c.req.header('Content-Type')?.split(';')[0]!=='application/json')throw new Problem(415,'JSON_REQUIRED');
 const reader=c.req.raw.body?.getReader();if(!reader)throw new Problem(400,'BODY_REQUIRED');let size=0;const parts:Uint8Array[]=[];
 while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>262144){await reader.cancel();throw new Problem(413,'CONTEXT_TOO_LARGE');}parts.push(p.value);}
 const raw=new Uint8Array(size);let offset=0;for(const p of parts){raw.set(p,offset);offset+=p.length;}
 return c.json(await service(c.env).register(raw));
});
