// Explicit production adapter. Not selected by local runtime; credentials stay in Worker Secrets.
export type CloudTasksConfig={enabled:boolean;project:string;location:string;queue:string;runUrl:string;invokerEmail:string;serviceAccountJson:string;computeToken:string};
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const url64=(bytes:Uint8Array)=>b64(bytes).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export async function cloudTasksDispatch(request:Request,config:CloudTasksConfig,transport:typeof fetch=fetch){
 if(!config.enabled)throw new Error('REMOTE_EXECUTION_NOT_APPROVED');
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(config.project)||!/^[a-z]+-[a-z]+\d$/.test(config.location)||!/^[A-Za-z0-9_-]{1,100}$/.test(config.queue)||!/^https:\/\/[a-z0-9-]+\.([a-z0-9-]+\.)?run\.app$/.test(config.runUrl)||!config.computeToken)throw new Error('INVALID_PINNED_DISPATCH_CONFIGURATION');
 const account=JSON.parse(config.serviceAccountJson);if(account.type!=='service_account'||!account.client_email?.endsWith('.iam.gserviceaccount.com')||typeof account.private_key!=='string')throw new Error('INVALID_SERVICE_ACCOUNT');
 const payload=await request.text();const job=JSON.parse(payload);if(!/^job-[a-f0-9-]{36}$/.test(job.jobId))throw new Error('INVALID_JOB');
 const now=Math.floor(Date.now()/1000),encoder=new TextEncoder();
 const header=url64(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),claims=url64(encoder.encode(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+300})));
 const pem=account.private_key.replace(/-----[^-]+-----|\s/g,'');const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);const message=header+'.'+claims;const assertion=message+'.'+url64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(message))));
 const tokenResponse=await transport('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});if(!tokenResponse.ok)throw new Error('TASK_AUTHENTICATION_FAILED');const token=await tokenResponse.json() as {access_token:string};if(!token.access_token)throw new Error('TASK_AUTHENTICATION_FAILED');
 const parent=`projects/${config.project}/locations/${config.location}/queues/${config.queue}`;
 const response=await transport('https://cloudtasks.googleapis.com/v2/'+parent+'/tasks',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},body:JSON.stringify({task:{name:parent+'/tasks/'+job.jobId,dispatchDeadline:'300s',httpRequest:{httpMethod:'POST',url:config.runUrl+'/execute',headers:{'Content-Type':'application/json','X-Compute-Token':config.computeToken},body:b64(encoder.encode(payload)),oidcToken:{serviceAccountEmail:config.invokerEmail,audience:config.runUrl}}}}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('TASK_DELIVERY_OUTCOME_UNKNOWN');return new Response('{"accepted":true}',{status:202,headers:{'Content-Type':'application/json'}});
}
