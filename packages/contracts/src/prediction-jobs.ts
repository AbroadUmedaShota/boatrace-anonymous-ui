export type PredictionMode = 'R5_PRE_RACE' | 'BASE_DAY_BEFORE' | 'BASE_SAME_DAY';
const predictionModes: readonly string[] = ['R5_PRE_RACE', 'BASE_DAY_BEFORE', 'BASE_SAME_DAY'];
export type PredictionTarget = {date:string;venueCode:string;raceNumber:number;mode:PredictionMode};
export type PredictionRequest = PredictionTarget & {idempotencyKey:string;budgetYen?:number|null;exhibitionOnly?:true;oddsFromJobId?:string};
type Rational={numerator:string;denominator:string};
export type TicketSetRisk = {loss_probability:string;hit_loss_probability:string;total_loss_probability:string;expected_net_yen:string;max_loss_yen:number};
export type TicketProposal={set_risk?:TicketSetRisk;schema_version:'boatrace-ticket-proposal/1';state:string;research_only:true;reference_only:true;purchase_eligible:false;purchase_authorized:false;operational_eligible:false;strategy_validated:false;budget_yen:number|null;cost_yen:number|null;policy:{schema_version:'ticket-set-research-policy/1';middle_min_odds:string;longshot_min_odds:string;min_expected_return_ratio:string;max_counts:{MAINLINE:number;MIDDLE:number;LONGSHOT:number}};policy_sha256:string;candidates:{combination:string;group:'MAINLINE'|'MIDDLE'|'LONGSHOT'|'UNCLASSIFIED';group_label:string;probability:number;odds:string|null;expected_return_ratio:string|null;stake_yen:number|null;recommended:boolean}[];groups:Partial<Record<'MAINLINE'|'MIDDLE'|'LONGSHOT',{group_label:string;count:number;coverage_probability:string;expected_return_ratio:string|null}>>;mainline_gate:{status:string;return_ratio:Rational|null;return_percent:string|null;threshold:Rational}|null;classification_basis:'ODDS_BANDS_NOT_CONFIDENCE';reasons:string[]};
export type LivePrediction = {finishByLane?:number[][];schemaVersion:'boatrace-live-prediction/1';jobId:string;status:'AVAILABLE'|'HELD';executionMode:'SAVED_REPLAY'|'LIVE';generatedAt:string;observedAt:string|null;oddsObservedAt:string|null;modelAvailableAt:string|null;inputSha256:string|null;requestSha256:string;modelSha256:string|null;modelCreatedAt:string|null;sourceRefs:string[];reasons:string[];combinations:string[];probabilities:number[]|null;odds:(string|null)[]|null;cutoffAt:string|null;decisionAt:string|null;purchaseEligible:false;historicalOnly:boolean;ticketProposal:TicketProposal|null};
export type PredictionJob = {recoveryRequired?:boolean;schemaVersion:'boatrace-prediction-job/1';id:string;executionMode:'SAVED_REPLAY'|'LIVE';state:'QUEUED'|'RUNNING'|'COMPLETED'|'HELD'|'FAILED';request:PredictionRequest;createdAt:string;updatedAt:string;reasons:string[];result:LivePrediction|null};
export function assertPredictionRequest(value:unknown):asserts value is PredictionRequest {
 const v=value as PredictionRequest;
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.date!=='string'||typeof v.venueCode!=='string'||typeof v.idempotencyKey!=='string')throw new Error('INVALID_PREDICTION_REQUEST');
 if(!Object.keys(v).every(key=>['date','idempotencyKey','mode','raceNumber','venueCode','budgetYen','exhibitionOnly','oddsFromJobId'].includes(key))||
  'exhibitionOnly'in v&&(v.exhibitionOnly!==true||v.mode!=='R5_PRE_RACE'||'oddsFromJobId'in v||'budgetYen'in v)||
  'oddsFromJobId'in v&&(v.mode!=='R5_PRE_RACE'||typeof v.oddsFromJobId!=='string'||!/^job-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.oddsFromJobId))||
  'budgetYen'in v&&v.budgetYen!==null&&(!Number.isSafeInteger(v.budgetYen)||v.budgetYen!<=0||v.budgetYen!%100!==0)||
  !validPredictionRace(v)||!predictionModes.includes(v.mode)||!/^[A-Za-z0-9_-]{1,100}$/.test(v.idempotencyKey)) throw new Error('INVALID_PREDICTION_REQUEST');
}
function closed(v:unknown,keys:string):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys;}
export function validPredictionRace(target: {date: unknown; venueCode: unknown; raceNumber: unknown}): boolean {
 if (typeof target.date !== 'string' || typeof target.venueCode !== 'string' || typeof target.raceNumber !== 'number') return false;
 if (!/^\d{4}-\d{2}-\d{2}$/.test(target.date)) return false;
 const stamp = new Date(target.date + 'T00:00:00Z');
 return Number.isFinite(stamp.getTime()) && stamp.toISOString().slice(0, 10) === target.date &&
  /^(0[1-9]|1[0-9]|2[0-4])$/.test(target.venueCode) && Number.isInteger(target.raceNumber) && target.raceNumber >= 1 && target.raceNumber <= 12;
}
export function parseSavedPredictionTargets(value: unknown): PredictionTarget[] {
 if (!Array.isArray(value) || value.length > 3) throw Error('INVALID_SAVED_PREDICTION_TARGETS');
 const modes = new Set<string>();
 for (const target of value) {
  if (!closed(target, 'date,mode,raceNumber,venueCode') ||
      typeof target.mode !== 'string' || !predictionModes.includes(target.mode) || modes.has(target.mode) ||
      !validPredictionRace({date: target.date, venueCode: target.venueCode, raceNumber: target.raceNumber})) {
   throw Error('INVALID_SAVED_PREDICTION_TARGETS');
  }
  modes.add(target.mode);
 }
 return value;
}
export function matchesSavedPredictionTarget(targets: readonly PredictionTarget[], requested: PredictionTarget): boolean {
 return targets.some(target => target.mode === requested.mode && target.date === requested.date &&
  target.venueCode === requested.venueCode && target.raceNumber === requested.raceNumber);
}
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stamp=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const texts=(v:unknown)=>Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length<=256&&!/[\\/]/.test(x));
const combination=(v:unknown)=>typeof v==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(v)&&new Set(v.split('-')).size===3;
export type PredictionUsage={schemaVersion:'boatrace-prediction-usage/1';day:string;asOf:string;jobs:{used:number;limit:6;remaining:number};http:{used:number;limit:24;remaining:number};recoveryRequired:boolean};
export function assertPredictionUsage(value:unknown):asserts value is PredictionUsage {
 const v=value as PredictionUsage;
 const quota=(x:PredictionUsage['jobs']|PredictionUsage['http'],limit:number)=>closed(x,'limit,remaining,used')&&x.limit===limit&&Number.isSafeInteger(x.used)&&x.used>=0&&Number.isSafeInteger(x.remaining)&&x.remaining===Math.max(0,limit-x.used);
 if(!closed(v,'asOf,day,http,jobs,recoveryRequired,schemaVersion')||v.schemaVersion!=='boatrace-prediction-usage/1'||!stamp(v.asOf)||new Date(v.asOf.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==v.asOf.slice(0,10)||typeof v.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.day)||new Date(Date.parse(v.asOf)+32400000).toISOString().slice(0,10)!==v.day||!quota(v.jobs,6)||!quota(v.http,24)||typeof v.recoveryRequired!=='boolean')throw new Error('INVALID_PREDICTION_USAGE');
}
export function assertLivePrediction(value:unknown,id:string):asserts value is LivePrediction {
 const v=value as LivePrediction;
 const keys='combinations,cutoffAt,decisionAt,executionMode,generatedAt,historicalOnly,inputSha256,jobId,modelAvailableAt,modelCreatedAt,modelSha256,observedAt,odds,oddsObservedAt,probabilities,purchaseEligible,reasons,requestSha256,schemaVersion,sourceRefs,status,ticketProposal';
 if((!closed(v,keys)&&!closed(v,keys.replace(',generatedAt',',finishByLane,generatedAt')))||v.schemaVersion!=='boatrace-live-prediction/1'||v.jobId!==id||v.purchaseEligible!==false||!['AVAILABLE','HELD'].includes(v.status)||!['SAVED_REPLAY','LIVE'].includes(v.executionMode)||v.historicalOnly!==(v.executionMode==='SAVED_REPLAY')||!stamp(v.generatedAt)||v.observedAt!==null&&!stamp(v.observedAt)||v.oddsObservedAt!==null&&!stamp(v.oddsObservedAt)||v.modelAvailableAt!==null&&!stamp(v.modelAvailableAt)||!digest(v.requestSha256)||v.inputSha256!==null&&!digest(v.inputSha256)||v.modelSha256!==null&&!digest(v.modelSha256)||v.modelCreatedAt!==null&&!stamp(v.modelCreatedAt)||v.cutoffAt!==null&&!stamp(v.cutoffAt)||v.decisionAt!==null&&!stamp(v.decisionAt)||!texts(v.reasons)||!Array.isArray(v.sourceRefs)||!v.sourceRefs.every(digest)||!Array.isArray(v.combinations)||!v.combinations.every(combination)||new Set(v.combinations).size!==v.combinations.length||v.combinations.length!==0&&v.combinations.length!==120||v.probabilities!==null&&(!Array.isArray(v.probabilities)||v.probabilities.length!==120||v.combinations.length!==120||v.probabilities.some(x=>typeof x!=='number'||!Number.isFinite(x)||x<0||x>1))||v.odds!==null&&(!Array.isArray(v.odds)||v.odds.length!==v.combinations.length||v.odds.some(x=>x!==null&&(typeof x!=='string'||!/^\d+(?:\.\d+)?$/.test(x)))))throw new Error('INVALID_LIVE_PREDICTION');
 if(v.status==='HELD'&&(v.probabilities!==null||v.odds!==null||v.ticketProposal!==null||v.combinations.length!==0||v.reasons.length===0))throw new Error('HELD_RESULT_HAS_VALUES');
 if(v.status==='AVAILABLE'&&(!v.modelSha256||!v.inputSha256||!v.probabilities))throw new Error('INVALID_AVAILABLE_PREDICTION');
 if(v.executionMode==='LIVE'&&v.status==='AVAILABLE'&&(!v.decisionAt||!v.cutoffAt||Date.parse(v.decisionAt)>=Date.parse(v.cutoffAt)))throw new Error('INVALID_LIVE_TIMING');
 if(v.finishByLane!==undefined){
  if(v.status!=='AVAILABLE'||!Array.isArray(v.finishByLane)||v.finishByLane.length!==6||
     !v.finishByLane.every(lane=>Array.isArray(lane)&&lane.length===3&&lane.every(p=>Number.isFinite(p)&&p>=0&&p<=1))||
     [0,1,2].some(position=>Math.abs(v.finishByLane!.reduce((sum,lane)=>sum+lane[position],0)-1)>1e-9))
   throw new Error('INVALID_FINISH_BY_LANE');
 }
 if(v.ticketProposal!==null)assertTicketProposal(v.ticketProposal);
}
const decimal=(v:unknown)=>typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v);
const money=(v:unknown)=>v===null||typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v%100===0;
function rational(v:unknown):boolean {const x=v as Rational;return closed(x,'denominator,numerator')&&/^-?\d+$/.test(x.numerator)&&/^[1-9]\d*$/.test(x.denominator);}
export function assertTicketProposal(value:unknown):asserts value is TicketProposal {
 const t=value as TicketProposal;
 const candidate=(c:TicketProposal['candidates'][number])=>closed(c,'combination,expected_return_ratio,group,group_label,odds,probability,recommended,stake_yen')&&combination(c.combination)&&['MAINLINE','MIDDLE','LONGSHOT','UNCLASSIFIED'].includes(c.group)&&typeof c.group_label==='string'&&typeof c.probability==='number'&&Number.isFinite(c.probability)&&c.probability>0&&c.probability<=1&&(c.odds===null||decimal(c.odds))&&(c.expected_return_ratio===null||decimal(c.expected_return_ratio))&&money(c.stake_yen)&&typeof c.recommended==='boolean';
 const keys='budget_yen,candidates,classification_basis,cost_yen,groups,mainline_gate,operational_eligible,policy,policy_sha256,purchase_authorized,purchase_eligible,reasons,reference_only,research_only,schema_version,state,strategy_validated';
 if((!closed(t,keys)&&!closed(t,keys.replace(',state',',set_risk,state')))||t.schema_version!=='boatrace-ticket-proposal/1'||t.research_only!==true||t.reference_only!==true||t.purchase_eligible!==false||t.purchase_authorized!==false||t.operational_eligible!==false||t.strategy_validated!==false||typeof t.state!=='string'||!money(t.budget_yen)||!money(t.cost_yen)||!digest(t.policy_sha256)||t.classification_basis!=='ODDS_BANDS_NOT_CONFIDENCE'||!texts(t.reasons)||!Array.isArray(t.candidates)||t.candidates.length>6||!t.candidates.every(candidate))throw new Error('INVALID_TICKET_PROPOSAL');
 if(t.set_risk!==undefined){
  const risk=t.set_risk;
  const probability=(value:unknown)=>decimal(value)&&Number(value)>=0&&Number(value)<=1;
  if(!closed(risk,'expected_net_yen,hit_loss_probability,loss_probability,max_loss_yen,total_loss_probability')||
     !probability(risk.loss_probability)||!probability(risk.hit_loss_probability)||!probability(risk.total_loss_probability)||
     !decimal(risk.expected_net_yen)||!money(risk.max_loss_yen)||risk.max_loss_yen<=0||risk.max_loss_yen!==t.cost_yen||
     t.state!=='RESEARCH_BUDGETED_PROPOSAL')throw new Error('INVALID_TICKET_SET_RISK');
 }
 const p=t.policy;if(!closed(p,'longshot_min_odds,max_counts,middle_min_odds,min_expected_return_ratio,schema_version')||p.schema_version!=='ticket-set-research-policy/1'||!decimal(p.middle_min_odds)||!decimal(p.longshot_min_odds)||!decimal(p.min_expected_return_ratio)||!closed(p.max_counts,'LONGSHOT,MAINLINE,MIDDLE')||!Object.values(p.max_counts).every(x=>Number.isInteger(x)&&x>=0&&x<=6))throw new Error('INVALID_TICKET_POLICY');
 if(!t.groups||typeof t.groups!=='object'||Array.isArray(t.groups)||Object.keys(t.groups).some(k=>!['MAINLINE','MIDDLE','LONGSHOT'].includes(k))||Object.values(t.groups).some(g=>!closed(g,'count,coverage_probability,expected_return_ratio,group_label')||typeof g.group_label!=='string'||!Number.isInteger(g.count)||g.count<0||g.count>6||!decimal(g.coverage_probability)||g.expected_return_ratio!==null&&!decimal(g.expected_return_ratio)))throw new Error('INVALID_TICKET_GROUPS');
 const g=t.mainline_gate;if(g!==null&&(!closed(g,'return_percent,return_ratio,status,threshold')||typeof g.status!=='string'||g.return_ratio!==null&&!rational(g.return_ratio)||g.return_percent!==null&&!decimal(g.return_percent)||!rational(g.threshold)))throw new Error('INVALID_TICKET_GATE');
}
