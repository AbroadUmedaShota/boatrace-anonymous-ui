import {validPredictionRace} from './prediction-jobs';

type CatalogRace = {raceNumber:number;cutoffAt:string|null;status:'SCHEDULED'|'UNKNOWN'|'CANCELLED'};
export type RaceCatalog = {date:string;venueCode:string;sourceSha256:string;observedAt:string;races:CatalogRace[]};
const timestamp = (value:unknown):value is string => typeof value==='string' &&
 /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function parseRaceCatalog(value:unknown):RaceCatalog {
 const catalog=value as RaceCatalog;
 if(!catalog||typeof catalog!=='object'||Array.isArray(catalog)||
    Object.keys(catalog).sort().join()!=='date,observedAt,races,sourceSha256,venueCode'||
    !validPredictionRace({...catalog,raceNumber:1})||!timestamp(catalog.observedAt)||
    typeof catalog.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(catalog.sourceSha256)||
    !Array.isArray(catalog.races)||catalog.races.length<1||catalog.races.length>12)
  throw new Error('INVALID_RACE_CATALOG');
 const seen=new Set<number>();
 for(const race of catalog.races){
  if(!race||typeof race!=='object'||Object.keys(race).sort().join()!=='cutoffAt,raceNumber,status'||
     !validPredictionRace({date:catalog.date,venueCode:catalog.venueCode,raceNumber:race.raceNumber})||
     seen.has(race.raceNumber)||!['SCHEDULED','UNKNOWN','CANCELLED'].includes(race.status)||
     (race.status==='SCHEDULED'?!(timestamp(race.cutoffAt)&&race.cutoffAt.endsWith('+09:00')&&race.cutoffAt.startsWith(catalog.date+'T')):race.cutoffAt!==null))
   throw new Error('INVALID_CATALOG_RACE');
  seen.add(race.raceNumber);
 }
 return catalog;
}
