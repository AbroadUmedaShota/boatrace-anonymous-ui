import {assertPredictionRequest, type PredictionRequest} from './prediction-jobs';

export type ComputeDispatchRequest = {
  jobId: string;
  request: PredictionRequest;
  executionMode: 'SAVED_REPLAY' | 'LIVE';
  inputId: string;
};

export function assertComputeDispatchRequest(value: unknown): asserts value is ComputeDispatchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join() !== 'executionMode,inputId,jobId,request')
    throw new Error('INVALID_COMPUTE_DISPATCH_REQUEST');
  const v = value as ComputeDispatchRequest;
  if (typeof v.jobId !== 'string' || !/^job-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.jobId) ||
      !['SAVED_REPLAY', 'LIVE'].includes(v.executionMode) || typeof v.inputId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(v.inputId)) throw new Error('INVALID_COMPUTE_DISPATCH_REQUEST');
  assertPredictionRequest(v.request);
}
