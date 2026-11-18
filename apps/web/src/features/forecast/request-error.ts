export class PredictionServiceError extends Error {
 constructor(message:string,public readonly notAccepted=false,public readonly code?:string){super(message);}
}

// Only these status/code pairs reject a new request before job reservation/dispatch.
// An HTTP status alone is not evidence that submission had no effect.
const rejectedBeforeCreate:Record<number,readonly string[]>={
 400:['INVALID_PREDICTION_REQUEST','TARGET_DATE_MODE_MISMATCH','INVALID_BODY','BODY_REQUIRED','QUERY_NOT_ALLOWED'],
 401:['TOKEN_REQUIRED','AMBIGUOUS_CREDENTIALS','INVALID_OR_EXPIRED_TOKEN','INVALID_OR_EXPIRED_ACCESS_TOKEN','ACCESS_ASSERTION_REQUIRED'],
 403:['FORBIDDEN_ROLE','PREDICTION_REQUEST_NOT_ALLOWED'],
 409:['PREDICTION_ACCEPTANCE_CLOSED','RECOVERY_REQUIRED','CLOUD_OWNER_SAVED_TARGET_NOT_APPROVED'],
 429:['SHARED_QUOTA_OR_COOLDOWN'],
};
function problemCode(value:unknown):string|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).join()!=='error')return;
 const error=(value as {error?:unknown}).error;
 if(!error||typeof error!=='object'||Array.isArray(error)||Object.keys(error).join()!=='code')return;
 const code=(error as {code?:unknown}).code;
 return typeof code==='string'&&/^[A-Z0-9_]+$/.test(code)?code:undefined;
}
export async function predictionRequestError(response:Response,operation:'READ'|'CREATE'='READ'):Promise<PredictionServiceError> {
 const json=!response.redirected&&response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()==='application/json';
 const code=json?problemCode(await response.json().catch(()=>null)):undefined;
 const notAccepted=operation==='CREATE'&&!!code&&rejectedBeforeCreate[response.status]?.includes(code)===true;
 if(response.status===409&&code==='RECOVERY_REQUIRED'){
  const error=new PredictionServiceError('新規依頼は受け付けていません。管理者による期限切れ依頼の復旧が必要です。復旧後に、対象を選んで改めて依頼してください。',notAccepted,code);
  error.name='RecoveryRequired';return error;
 }
 const messages:Record<number,string>={401:'認証が無効または期限切れです。再接続してください。',403:'予想依頼または閲覧の権限がありません。',404:'依頼が見つからないか、閲覧できません。',409:'同じ依頼の内容が異なるか、処理状態が競合しています。',429:'共有環境の利用上限が通知されました。受付状態を確認してください。'};
 const message=notAccepted&&response.status===429?'共有上限または同じ対象の待機時間により、依頼を受け付けていません。条件や待機時間を確認してください。':
  notAccepted&&response.status===400?'指定した条件を受け付けられません。対象日・予想の種類・入力値を確認してください。':
  notAccepted&&code==='PREDICTION_ACCEPTANCE_CLOSED'?'現在、新しい予想依頼の受付は停止しています。':
  notAccepted&&code==='CLOUD_OWNER_SAVED_TARGET_NOT_APPROVED'?'登録済みの保存入力から対象を選び、改めて依頼してください。':messages[response.status]??`サービスを確認できません（HTTP ${response.status}）。`;
 const error=new PredictionServiceError(message,notAccepted,code);
 if(response.status===401)error.name='AuthenticationRequired';
 return error;
}
