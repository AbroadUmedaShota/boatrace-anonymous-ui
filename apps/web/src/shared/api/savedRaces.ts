import { browserAuth, rejectExpiredAccessSession } from './browserAuth';
import { ViewerError } from './evaluations';
import { parseSavedPage, parseSavedRecordDetail, type SavedDate, type SavedVenue, type SavedPage } from '@boatrace/contracts';

export async function readSavedPages<T>(path: string, token: string, signal: AbortSignal, parse: (value: unknown) => SavedPage<T>): Promise<SavedPage<T>> {
  const first = await readSaved(path, token, signal, parse);
  const items = [...first.items];
  const cursors = new Set<string>();
  let cursor = first.nextCursor;
  while (cursor !== null) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (cursors.has(cursor)) throw new ViewerError('保存一覧のページ送りを確認できません。');
    cursors.add(cursor);
    const [resource, query = ''] = path.split('?');
    const params = new URLSearchParams(query); params.set('cursor', cursor);
    const next = await readSaved(`${resource}?${params}`, token, signal, parse);
    items.push(...next.items); cursor = next.nextCursor;
  }
  return {status: 'AVAILABLE', items, nextCursor: null};
}

export const parseRecordPage = (value: unknown) => parseSavedPage(value, parseSavedRecordDetail);
export const parseDatePage = (value: unknown) => parseSavedPage<SavedDate>(value, item => {
  const v = item as SavedDate;
  if (!v || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new Error('INVALID_DATE');
  return v;
});
export const parseVenuePage = (value: unknown) => parseSavedPage<SavedVenue>(value, item => {
  const v = item as SavedVenue;
  if (!v || typeof v.venueCode !== 'string' || !/^\d{2}$/.test(v.venueCode) || !(v.venueName === null || typeof v.venueName === 'string')) throw new Error('INVALID_VENUE');
  return v;
});

export async function readSaved<T>(path: string, token: string, signal: AbortSignal, parse: (value: unknown) => T): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 15_000);
  try {
    const response = await fetch(`/api/saved-races/${path}`, {
      method: 'GET', ...browserAuth(token), cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) {
      rejectExpiredAccessSession(response.status);
      const messages: Record<number, string> = {
        401: '接続トークンが無効か期限切れです。',
        403: 'この保存記録を閲覧する権限がありません。',
        404: '保存記録が存在しないか、閲覧許可が取り下げられています。',
        410: 'この保存記録の閲覧は取り下げられています。',
        429: '読込の回数制限に達しました。時間をおいて接続してください。',
      };
      throw new ViewerError(messages[response.status] ?? `保存記録を読み込めませんでした（HTTP ${response.status}）。`, response.status);
    }
    try { return parse(await response.json()); }
    catch { throw new ViewerError('保存記録の形式を確認できません。数値は表示していません。'); }
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof ViewerError) throw error;
    throw new ViewerError(controller.signal.aborted ? '読込が時間内に完了しませんでした。' : 'ローカルの保存記録サービスに接続できません。');
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
