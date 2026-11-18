import { parseEvaluationSession, type EvaluationSession } from '@boatrace/contracts';
export const accessBrowserMode = (import.meta as ImportMeta & {env?:Record<string,string>}).env?.VITE_BOAT_AUTH_MODE === 'cloudflare-access';
// An internal connection marker, not a token. Never sent as Authorization.
export const ACCESS_CONNECTION = 'access-cookie-session';
export type BrowserSession = EvaluationSession | {role:'viewer'|'admin'|'registrar'|'compute';authentication:'ACCESS_PRODUCTION_CANDIDATE';local_only:false;actual_access_verified:false};
export function browserAuth(token:string,json=false): {headers:Record<string,string>;credentials:RequestCredentials} {
 return {headers:{...(!accessBrowserMode?{Authorization:`Bearer ${token}`}:{}) ,...(json?{'Content-Type':'application/json'}:{})},credentials:accessBrowserMode?'same-origin':'omit'};
}
export function parseBrowserSession(value:unknown):BrowserSession {
 if(!accessBrowserMode){const session=parseEvaluationSession(value);if(session.local_only!==true)throw new Error('LOCAL_AUTH_MODE_REQUIRED');return session;}
 const v=value as BrowserSession;
 if(!v||Object.keys(v).sort().join()!=='actual_access_verified,authentication,local_only,role'||v.authentication!=='ACCESS_PRODUCTION_CANDIDATE'||v.local_only!==false||v.actual_access_verified!==false||!['viewer','admin','registrar','compute'].includes(v.role))throw new Error('INVALID_ACCESS_SESSION');return v;
}

export function rejectExpiredAccessSession(status:number){if(accessBrowserMode&&status===401)window.dispatchEvent(new Event('boat-access-session-invalid'));}
