const labels: Readonly<Record<string, string>> = {
  EXECUTION_OUTCOME_UNKNOWN: '処理結果を確認できません。履歴をご確認ください。',
  DISPATCH_OUTCOME_UNKNOWN: '処理の引き渡し結果を確認できません。履歴をご確認ください。',
  RESULT_ARTIFACT_INVALID: '保存された結果を確認できません。管理者にお問い合わせください。',
  CLOCK_UNVERIFIED: '時刻の正確性を確認できないため保留しました。',
  CLOCK_PROOF_UNAVAILABLE: '標準時刻の確認先に接続できないため保留しました。',
  TIMEZONE_REQUIRED: '時刻のタイムゾーンを確認できないため保留しました。',
  EXHIBITION_NOT_PUBLISHED: '展示情報がまだ公表されていないため保留しました。',
  PAGE_RACE_MISMATCH: '取得したページから指定レースの情報を確認できませんでした。',
  INPUT_OR_MODEL_UNAVAILABLE: '必要な入力またはモデルを利用できません。',
  INPUT_RACE_MISMATCH: '入力と指定したレースが一致しません。',
  INPUT_MODE_MISMATCH: '入力と指定した予想の種類が一致しません。',
  INVALID_PINNED_MODEL: '指定モデルの内容を確認できないため保留しました。',
  INVALID_MODEL_CREATED_AT: 'モデルの作成時刻を確認できないため保留しました。',
  REMOTE_MODEL_SHA_MISMATCH: '取得したモデルを指定された照合情報で確認できないため保留しました。',
  MODEL_NOT_AVAILABLE_AT_DECISION: '判断時点で利用できるモデルではありません。',
  MODEL_FITTED_AFTER_AVAILABILITY: 'モデルの学習時刻と利用可能時刻の順序を確認できないため保留しました。',
  CAPTURE_DATE_MODE_MISMATCH: '取得日と指定した予想の種類が一致しません。',
  CAPTURE_AFTER_CUTOFF: '取得・確認が締切に間に合わないため保留しました。',
  INSUFFICIENT_PRE_CUTOFF_WINDOW: '締切までに取得・確認する時間が足りません。',
  CAPTURE_PRICE_TIME_INVALID: '掲載されたオッズの更新時刻が、この予想に使える時刻条件を満たさないため保留しました。',
  CAPTURE_TIME_ORDER_INVALID: '取得・判断・締切などの時刻の順序を確認できないため保留しました。',
  CAPTURE_PROVENANCE_MISMATCH: '取得元の情報と指定対象を照合できないため保留しました。',
  LIVE_TIME_NOT_ELIGIBLE: '取得・判断・締切などの時刻条件を満たさないため保留しました。',
  LIVE_COMPLETION_AFTER_CUTOFF_OR_STALE: '締切前の計算完了または情報の鮮度を確認できないため保留しました。',
  LIVE_FIRST_FETCH_UNVERIFIED: '最初の情報取得時刻を確認できないため保留しました。',
  LIVE_FIRST_FETCH_STALE: '最初の情報取得から計算完了までの時間が鮮度の基準である5分以内に収まらなかったため保留しました。',
  LIVE_CAPTURE_NOT_APPROVED: '依頼に伴う情報取得が許可されていないため保留しました。',
  LIVE_EVIDENCE_REQUIRED: '依頼に伴う情報取得の記録を確認できないため保留しました。',
  ACQUISITION_DEADLINE: '情報取得が処理時間の上限に達したため保留しました。',
  ACQUISITION_UNAVAILABLE: '予想に必要な情報を取得できないため保留しました。',
  EXHIBITION_PARENT_STALE: '元の展示情報が古いか、発売締切までの余裕がありません。',
  EXHIBITION_PARENT_FIRST_FETCH_MISSING: '元の展示予想に最初の取得時刻の記録がありません。',
  EXHIBITION_PARENT_INPUT_MISMATCH: '元の展示予想の保存入力を照合できませんでした。',
  PRICE_UNVERIFIED: 'オッズを照合できないため保留しました。',
  PRICE_STALE: '掲載されたオッズの更新時刻が予想に使える時刻条件を満たさないため保留しました。',
  PRICE_TIME_UNPROVEN_OR_STALE: '掲載されたオッズの更新時刻を確認できないか、情報が古いため使用していません。',
  REPLAY_EVIDENCE_REQUIRED: '保存入力の検証資料が不足しています。',
  SAVED_INPUT_REPLAY_ONLY: '保存入力の再生結果です。',
  RESEARCH_ONLY: '研究用の参考結果です。',
  PROBABILITY_ONLY_PROVISIONAL: '確率のみの参考表示',
  RESEARCH_CANDIDATE_PREVIEW: '研究用の買い目候補',
  RESEARCH_BUDGETED_PROPOSAL: '試行配分付きの研究用候補',
  SKIP_MAINLINE: '本線条件を満たさず見送り',
  MAINLINE_NOT_SELECTED: '本線候補の選出なし',
  MAINLINE_BELOW: '本線の期待収益率が基準未達',
  MAINLINE_PASS: '本線の期待収益率が基準に到達',
  MAINLINE_BELOW_140: '本線の期待収益率が140%の基準に達しませんでした。',
  HELD: '保留',
  CONVERSION_THRESHOLD_AMBIGUOUS: '数値の扱いによって本線の閾値判定が変わるため保留しました。',
  RESEARCH_POLICY_UNVALIDATED: '候補の選び方は研究段階で、有用性は未確認です。',
  PURCHASE_NOT_AUTHORIZED: 'この結果は購入不可です。',
  PRICE_UNAVAILABLE_NO_CLASSIFICATION: 'オッズがないため買い目を分類していません。',
  BUDGET_UNSET_CANDIDATE_PREVIEW_ONLY: '予算が指定されていないため候補のみを表示します。',
};

export function forecastCodeLabel(code: string): string {
  return Object.hasOwn(labels, code) ? `${labels[code]}（${code}）` : code;
}

export function forecastReasonLabels(reasons: string[]): string[] {
  return [...new Set(reasons)].map(forecastCodeLabel);
}

export const liveForecastMethod = '依頼時に取得した情報を使う予想方式';

export function blocksNewLiveForecast(anonymousOwnerTrial: boolean, executionMode: string | undefined): boolean {
  return anonymousOwnerTrial && executionMode === 'LIVE';
}
