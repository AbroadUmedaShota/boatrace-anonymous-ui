import {Problem} from '../evaluations/domain';
import {trustEndpoint} from './https-jwks';
import {validateAccessPins,verifyAccessIdentity,type AuthBindings,type LocalIdentity} from './verified-auth';
export async function authenticateProduction(request:Request,env:AuthBindings):Promise<LocalIdentity>{
 if(env.AUTH_MODE!=='ACCESS_PRODUCTION_RS256'||env.PRODUCTION_ACCESS_ENABLED!=='true'||env.LOCAL_ONLY!=='false')throw new Problem(403,'PRODUCTION_ACCESS_NOT_ENABLED');
 let origin:URL;try{origin=new URL(env.ACCESS_PUBLIC_ORIGIN??'');if(origin.protocol!=='https:'||origin.origin!==env.ACCESS_PUBLIC_ORIGIN||origin.username||origin.password||!origin.hostname.includes('.')||['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw new Error();trustEndpoint(env.ACCESS_ISSUER,env.ACCESS_JWKS_URL);}catch{throw new Problem(403,'PRODUCTION_ACCESS_PINS_INVALID');}
 const url=new URL(request.url);if(url.origin!==origin.origin||request.headers.has('Host')&&request.headers.get('Host')!==origin.host)throw new Problem(403,'PRODUCTION_HOST_MISMATCH');
 const requestOrigin=request.headers.get('Origin');if(requestOrigin&&requestOrigin!==origin.origin)throw new Problem(403,'INVALID_ORIGIN');
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');if(request.headers.has('Authorization')||!assertion||!/^[A-Za-z0-9_.-]+$/.test(assertion))throw new Problem(401,'ACCESS_ASSERTION_REQUIRED');
 const pins=validateAccessPins({...env,ACCESS_JWKS_JSON:'{"keys":[]}'},true);
 if(pins.bindings.some(binding=>binding.kind==='user'?!['viewer','admin'].includes(binding.role):!['registrar','compute'].includes(binding.role)))throw new Problem(403,'PRODUCTION_ROLE_PINS_INVALID');
 const identity=await verifyAccessIdentity(assertion,env,pins,'ACCESS_HTTPS_JWKS_RS256');
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&identity.identity_kind==='user'&&requestOrigin!==origin.origin)throw new Problem(403,'USER_WRITE_ORIGIN_REQUIRED');
 return {...identity,authentication:'ACCESS_PRODUCTION_CANDIDATE',local_only:false,actual_access_verified:false};
}
