import { assertLivePrediction, assertPredictionRequest, type PredictionJob, type PredictionMode } from '@boatrace/contracts';
import { browserAuth, rejectExpiredAccessSession } from '../../shared/api/browserAuth';
import { predictionRequestError } from './request-error';
import { liveForecastMethod } from './forecast-presentation';

export const jobsPath = '/api/prediction-jobs';
export const venues = ['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'];
export const modes: Record<PredictionMode, string> = {
  BASE_DAY_BEFORE: '前日予想',
  BASE_SAME_DAY: '当日予想',
  R5_PRE_RACE: '直前情報を使った予想',
};
export const states: Record<PredictionJob['state'], string> = {
  QUEUED: '順番待ち',
  RUNNING: '予想を作成しています',
  COMPLETED: '予想の作成が完了しました',
  HELD: '予想を表示できません',
  FAILED: '予想を作成できませんでした',
};

export function executionLabel(job: PredictionJob) {
  return job.executionMode === 'SAVED_REPLAY' ? '保存データでの動作確認' : liveForecastMethod;
}

export function parseJob(value: unknown): PredictionJob {
  const job = (value as {job?: PredictionJob})?.job;
  if (!job || job.schemaVersion !== 'boatrace-prediction-job/1' ||
      typeof job.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(job.id) ||
      !Object.hasOwn(states, job.state) || !Array.isArray(job.reasons)) {
    throw new Error('予想依頼の形式を確認できません。');
  }
  if (job.recoveryRequired !== undefined && typeof job.recoveryRequired !== 'boolean') {
    throw new Error('予想依頼の復旧状態を確認できません。');
  }
  if (job.executionMode !== 'SAVED_REPLAY' && job.executionMode !== 'LIVE') {
    throw new Error('予想依頼の実行区分を確認できません。');
  }
  assertPredictionRequest(job.request);
  if (job.result) {
    assertLivePrediction(job.result, job.id);
    if (job.executionMode !== job.result.executionMode) {
      throw new Error('依頼と結果の実行区分が一致しません。');
    }
  }
  return job;
}

export function parseJobList(value: unknown): PredictionJob[] {
  const items = (value as {items?: unknown})?.items;
  if (!Array.isArray(items) || items.length > 50) throw new Error('依頼一覧の形式を確認できません。');
  return items.map(item => parseJob({job: item}));
}

export async function requestValue(token:string, path:string, signal:AbortSignal, body?:unknown) {
 const creating=body!==undefined;
 const response=await fetch(path,{method:creating?'POST':'GET',...browserAuth(token,creating),cache:'no-store',signal,...(creating?{body:JSON.stringify(body)}:{})});
 if(!response.ok){rejectExpiredAccessSession(response.status);throw await predictionRequestError(response,creating&&path==='/api/prediction-jobs'?'CREATE':'READ');}
 return response.json();
}
