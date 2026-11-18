export * from './verified-auth';
import {authenticate,type AuthBindings} from './verified-auth';
import {authenticateProduction} from './production-auth';
export const authenticateApplication=(request:Request,env:AuthBindings)=>env.AUTH_MODE==='ACCESS_PRODUCTION_RS256'?authenticateProduction(request,env):authenticate(request,env);
