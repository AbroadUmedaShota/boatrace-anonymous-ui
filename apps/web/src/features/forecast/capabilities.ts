import { parseSavedPredictionTargets, type PredictionMode, type PredictionTarget } from '@boatrace/contracts';
export { validPredictionRace as validTarget } from '@boatrace/contracts';

export type Capabilities = {
  executionMode: 'LIVE' | 'SAVED_REPLAY';
  acquisitionApproved: boolean;
  canRequest: boolean;
  canAcquireOnRequest: boolean;
  savedTargets: PredictionTarget[];
  modes: PredictionMode[];
  limits: { jobsPerJstDay: number; httpPerJstDay: number; minHttpIntervalSeconds: number; sameTargetCooldownSeconds: number };
};
const modes = ['R5_PRE_RACE', 'BASE_DAY_BEFORE', 'BASE_SAME_DAY'];
export function parseCapabilities(value: unknown): Capabilities {
  const v = value as Capabilities;
  if (!v || !['LIVE', 'SAVED_REPLAY'].includes(v.executionMode) || typeof v.acquisitionApproved !== 'boolean' || typeof v.canRequest !== 'boolean' ||
      v.canAcquireOnRequest !== undefined && typeof v.canAcquireOnRequest !== 'boolean' || !Array.isArray(v.modes) || v.modes.length > 3 || new Set(v.modes).size !== v.modes.length || v.modes.some(m => !modes.includes(m)) ||
      v.modes.length === 0 && (v.canRequest || v.canAcquireOnRequest === true) ||
      !v.limits || Object.keys(v.limits).sort().join() !== 'httpPerJstDay,jobsPerJstDay,minHttpIntervalSeconds,sameTargetCooldownSeconds' || Object.values(v.limits).some(n => !Number.isSafeInteger(n) || n <= 0)) throw Error('予想サービスの実行条件を確認できません。');
  let savedTargets: PredictionTarget[];
  try {
    savedTargets = parseSavedPredictionTargets(v.savedTargets === undefined ? [] : v.savedTargets);
    if (savedTargets.some(target => !v.modes.includes(target.mode))) throw Error();
  } catch {
    throw Error('保存入力の対象を確認できません。');
  }
  return { ...v, canAcquireOnRequest: v.canAcquireOnRequest === true, savedTargets };
}
