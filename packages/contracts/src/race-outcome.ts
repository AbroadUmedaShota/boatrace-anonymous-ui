import {validPredictionRace} from './prediction-jobs';

type RaceKey = {date:string;venueCode:string;raceNumber:number};
type Provenance = {sourceSha256:string;sourceSavedAt:string};
export type RaceOutcome = RaceKey & Provenance & (
 {status:'FINAL';finish:number[];payoutYen:number} | {status:'CANCELLED'}
);

export function parseRaceOutcome(value:unknown):RaceOutcome {
 const row=value as RaceOutcome;
 if (!row || typeof row!=='object' || !validPredictionRace(row) ||
     !/^[a-f0-9]{64}$/.test(row.sourceSha256) || typeof row.sourceSha256!=='string' ||
     typeof row.sourceSavedAt!=='string' || !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(row.sourceSavedAt) ||
     !Number.isFinite(Date.parse(row.sourceSavedAt))) throw new Error('INVALID_RACE_OUTCOME');
 const keys=Object.keys(row).sort().join();
 if (row.status==='CANCELLED' && keys==='date,raceNumber,sourceSavedAt,sourceSha256,status,venueCode') return row;
 if (row.status==='FINAL' && keys==='date,finish,payoutYen,raceNumber,sourceSavedAt,sourceSha256,status,venueCode' &&
     Array.isArray(row.finish) && row.finish.length===6 && new Set(row.finish).size===6 &&
     row.finish.every(lane=>Number.isInteger(lane)&&lane>=1&&lane<=6) &&
     Number.isSafeInteger(row.payoutYen)&&row.payoutYen>0) return row;
 throw new Error('INVALID_RACE_OUTCOME');
}
