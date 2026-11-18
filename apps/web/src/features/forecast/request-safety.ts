import type {PredictionRequest} from '@boatrace/contracts';

export function liveContextAllowed(context:{valid:boolean;cutoffAt:string|null;state:string|null}|undefined,now=Date.now()):boolean {
 return !!context&&context.valid&&!!context.cutoffAt&&Number.isFinite(Date.parse(context.cutoffAt))&&Date.parse(context.cutoffAt)>now&&!/HELD|CANCEL|WITHDRAWN|FAILED/i.test(context.state??'');
}

export function jstTargetDate(mode:string,now=Date.now()):string {
 return new Date(now+9*3600000+(mode==='BASE_DAY_BEFORE'?86400000:0)).toISOString().slice(0,10);
}
export function manualAcquisitionAllowed(capability:{executionMode:string;canRequest:boolean;acquisitionApproved:boolean;canAcquireOnRequest:boolean}|null,target:{date:string;mode:string},context:{valid:boolean;cutoffAt:string|null;state:string|null}|undefined,embedded=false,now=Date.now()):boolean {
 if(!capability||capability.executionMode!=='LIVE'||!capability.canRequest||!capability.acquisitionApproved)return false;
 if(!['R5_PRE_RACE','BASE_SAME_DAY','BASE_DAY_BEFORE'].includes(target.mode)||target.date!==jstTargetDate(target.mode,now))return false;
 if(embedded||context)return liveContextAllowed(context,now);
 return capability.canAcquireOnRequest===true;
}

export function predictionNeedsRecovery(job:{state:string;reasons:string[];recoveryRequired?:boolean}):boolean {
 return job.state==='HELD'&&(job.recoveryRequired===true||job.recoveryRequired!==false&&job.reasons.some(reason=>['EXECUTION_OUTCOME_UNKNOWN','DISPATCH_OUTCOME_UNKNOWN'].includes(reason)));
}
export function predictionTerminalConfirmed(job:{state:string;reasons:string[];recoveryRequired?:boolean}):boolean {
 return ['COMPLETED','FAILED','HELD'].includes(job.state)&&!predictionNeedsRecovery(job);
}

export function restoredRequestDraft(currentKey:string,request:PredictionRequest,target?:{date:string;venue:string;raceNumber:number}) {
 if(currentKey===request.idempotencyKey||target&&(target.date!==request.date||target.venue!==request.venueCode||target.raceNumber!==request.raceNumber))return null;
 return {key:request.idempotencyKey,date:request.date,venue:request.venueCode,race:request.raceNumber,mode:request.mode,budget:request.budgetYen===null||request.budgetYen===undefined?'':String(request.budgetYen)};
}
