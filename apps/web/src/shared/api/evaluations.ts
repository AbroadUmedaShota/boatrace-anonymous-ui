import { browserAuth, parseBrowserSession, rejectExpiredAccessSession } from './browserAuth';
import { parseLatestEvaluation, parseEvaluationList, parseEvaluationDetail, parseEvaluationSession } from '@boatrace/contracts';

export class ViewerError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}

async function request(path: string, token: string, body?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      ...browserAuth(token,!!body),
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      rejectExpiredAccessSession(response.status);
      const messages: Record<number, string> = {
        401: 'トークンが無効か、期限が切れています。有効な閲覧トークンを入力してください。',
        403: 'このトークンには必要な権限がありません。閲覧許可とは別に、操作権限を確認してください。',
        404: '閲覧対象の評価が見つかりません。閲覧できない状態の評価も同じ表示になります。',
        409: '現在の登録状態・閲覧許可では操作できません。保存状態を読み直してください。',
        429: '読込の回数制限に達しました。少し待ってから再読込してください。',
      };
      throw new ViewerError(messages[response.status] ?? `保存評価を読めませんでした（HTTP ${response.status}）。`, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new ViewerError('保存評価の形式を確認できませんでした。数値は表示していません。');
    }
  } catch (error) {
    if (error instanceof ViewerError) throw error;
    throw new ViewerError(controller.signal.aborted
      ? '読込が時間内に完了しませんでした。接続状態を確認し、再読込してください。'
      : 'ローカルの評価サービスに接続できません。起動状態を確認してください。');
  } finally {
    window.clearTimeout(timeout);
  }
}

function checked<T>(value: unknown, parse: (value: unknown) => T): T {
  try { return parse(value); } catch { throw new ViewerError('保存評価の形式を確認できませんでした。数値は表示していません。'); }
}

export async function readLatestEvaluation(token: string) {
  return checked(await request('/api/evaluations/latest', token), parseLatestEvaluation);
}

export async function readEvaluationList(token: string, admin = false, cursor?: string) {
  const query = new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) });
  return checked(await request(`${admin ? '/api/admin/evaluations' : '/api/evaluations'}?${query}`, token), parseEvaluationList);
}

export async function readEvaluationDetail(token: string, id: string) {
  return checked(await request(`/api/evaluations/${encodeURIComponent(id)}`, token), parseEvaluationDetail);
}

export async function readEvaluationSession(token: string) {
  return checked(await request('/api/session', token), parseBrowserSession);
}

export type Visibility = 'PRIVATE' | 'VISIBLE' | 'SUPERSEDED' | 'WITHDRAWN';

export async function changeVisibility(token: string, id: string, visibility: Visibility) {
  const value = await request(`/api/admin/evaluations/${encodeURIComponent(id)}/visibility`, token, { visibility });
  if (!value || typeof value !== 'object' || !('evaluation_id' in value) || value.evaluation_id !== id || !('visibility' in value) || value.visibility !== visibility) throw new ViewerError('変更結果の応答は未確認です。保存状態を読み直してください。');
}

export async function selectLatest(token: string, id: string) {
  const value = await request('/api/admin/latest', token, { evaluation_id: id });
  if (!value || typeof value !== 'object' || !('evaluation_id' in value) || value.evaluation_id !== id || !('latest' in value) || value.latest !== true) throw new ViewerError('最新指定の結果は未確認です。保存状態を読み直してください。');
}
