import validate from './generated-saved-race-validator.js';
import {parseJsonLexemes, sameJsonValue} from './strict-json';
export type SavedTicketSet = {id: string; profile: string | null; state: string | null; createdAt: string | null; budgetYen: number | null;
  priceScope: string | null; classificationBasis: string | null; reasons: string[]; artifactSha256: string;
  candidates: {combination: string; probability: number | null; odds: string | null; group: string | null;
    groupLabel: string | null; expectedReturnRatio: string | null; recommended: false; stakeYen: number | null}[];
  groups: Partial<Record<'MAINLINE' | 'MIDDLE' | 'LONGSHOT', {count: number; coverageProbability: string | null;
    expectedReturnRatio: string | null; groupLabel: string | null}>>;
  mainlineGate: {status: string | null; returnPercent: string | null; returnRatio: string | null;
    threshold: {numerator: string; denominator: string}} | null};
export type SavedRaceRecord = {schemaVersion: 'boatrace-saved-race/1'; id: string; recordKind: 'race' | 'prediction';
  sourceKind: 'catalog' | 'real' | 'planning' | 'ticket-snapshot'; raceId: string; date: string; venueCode: string;
  venueName: string | null; raceNumber: number; title: string | null;
  entries: {lane: number; name: string | null; registrationNumber: string | null; exhibitionSeconds: string | null}[];
  model: {profile: string | null; name: string | null; sha256: string | null; availableAt: string | null; fittedAt: string | null} | null;
  createdAt: string | null; sourceCreatedAt: string | null; sourcePredictionId: string | null;
  sourceRaceId: string | null; captureId: string | null; captureUpperAt: string | null; decisionUpperAt: string | null;
  priceContext: {status: string | null; sourcePredictionId: string | null; decisionAt: string | null;
    cutoffAt: string | null; oddsObservedAt: string | null} | null;
  decisionAt: string | null; cutoffAt: string | null; completedAt: string | null;
  saveUpperBound: string | null; timeMode: string | null; status: string | null; priceStatus: string | null;
  probabilityScope: string | null; oddsObservedAt: string | null; combinations: string[]; probabilities: number[] | null;
  odds: (string | null)[] | null; storedReasons: string[]; holdReasons: string[]; displayWarnings: string[]; historicalOnly: true;
  operationalEligible: false; currentReusable: false;
  integrity: {rowSha256: string; finalizationSha256: string | null; sourceContextSha256: string | null; capturesVerified: boolean};
  ticketSets: SavedTicketSet[]; missingProfiles: string[]; numericLexemes: {probabilities: (string | null)[] | null; odds: (string | null)[] | null}};
export type SavedRecordDetail = {id: string; status: 'AVAILABLE' | 'HELD'; record: SavedRaceRecord | null;
  recordJsonUtf8: string | null; reasons: string[]};
export type SavedPage<T> = {status: 'AVAILABLE'; items: T[]; nextCursor: string | null};
export type SavedDate = {date: string};
export type SavedVenue = {venueCode: string; venueName: string | null};
export function assertSavedRaceRecord(value: unknown): asserts value is SavedRaceRecord {
  if (!validate(value)) throw new Error('INVALID_SAVED_RECORD_SCHEMA');
  const v = value as SavedRaceRecord;
  const stamp = new Date(v.date + 'T00:00:00Z');
  if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0,10) !== v.date ||
      v.raceId !== `race-${v.date.replaceAll('-','')}-${v.venueCode}-${String(v.raceNumber).padStart(2,'0')}` ||
      (v.recordKind === 'race' ? !['catalog','planning'].includes(v.sourceKind) || v.id !== v.raceId : v.sourceKind === 'catalog') ||
      new Set(v.entries.map(e => e.lane)).size !== v.entries.length ||
      new Set(v.combinations).size !== v.combinations.length ||
      v.combinations.some(c => !/^[1-6]-[1-6]-[1-6]$/.test(c) || new Set(c.split('-')).size !== 3) ||
      (v.probabilities && v.probabilities.length !== 0 && v.probabilities.length !== 120) ||
      (v.probabilities === null) !== (v.numericLexemes.probabilities === null) || (v.odds === null) !== (v.numericLexemes.odds === null) ||
      v.probabilities?.length !== v.numericLexemes.probabilities?.length || v.odds?.length !== v.numericLexemes.odds?.length ||
      (v.probabilities && v.probabilities.length !== 0 && v.probabilities.length !== v.combinations.length) ||
      (v.odds && v.odds.length !== 0 && v.odds.length !== v.combinations.length) ||
      v.probabilities?.some((p,i) => v.numericLexemes.probabilities![i] === null || JSON.parse(v.numericLexemes.probabilities![i]!) !== p) ||
      v.odds?.some((o,i) => o !== v.numericLexemes.odds![i])) throw new Error('INVALID_SAVED_RECORD_BRIDGE');
}
export function parseSavedRecordDetail(value: unknown): SavedRecordDetail {
  const v = value as SavedRecordDetail;
  if (!v || Object.keys(v).sort().join() !== 'id,reasons,record,recordJsonUtf8,status' ||
      typeof v.id !== 'string' || !['AVAILABLE','HELD'].includes(v.status) || !Array.isArray(v.reasons) ||
      !v.reasons.every(s => typeof s === 'string')) throw new Error('INVALID_SAVED_DETAIL');
  if (v.record === null) { if (v.status !== 'HELD' || v.recordJsonUtf8 !== null) throw new Error('INVALID_SAVED_DETAIL'); }
  else {
    assertSavedRaceRecord(v.record);
    if (v.record.id !== v.id || typeof v.recordJsonUtf8 !== 'string' ||
        !sameJsonValue(parseJsonLexemes(v.recordJsonUtf8).value, v.record)) throw new Error('INVALID_SAVED_DETAIL_BRIDGE');
  }
  return v;
}
export function parseSavedPage<T>(value: unknown, parseItem: (item: unknown) => T): SavedPage<T> {
  const v = value as SavedPage<unknown>;
  if (!v || Object.keys(v).sort().join() !== 'items,nextCursor,status' || v.status !== 'AVAILABLE' ||
      !Array.isArray(v.items) || v.items.length > 50 || (v.nextCursor !== null && typeof v.nextCursor !== 'string')) throw new Error('INVALID_SAVED_PAGE');
  return {...v, items: v.items.map(parseItem)};
}
