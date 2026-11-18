import type { SavedRecordDetail } from '@boatrace/contracts';
import { formatJstTimestamp } from '../forecast/daily-presentation';

export function savedRaceId(date: string, venue: string, raceNumber: number) {
  return `race-${date.replaceAll('-', '')}-${venue}-${String(raceNumber).padStart(2, '0')}`;
}

function savedRaceHref(date: string, venue: string, raceNumber: number, record?: string) {
  const query = new URLSearchParams({ date, venue, race: savedRaceId(date, venue, raceNumber) });
  if (record) query.set('record', record);
  return `#races?${query}`;
}

export default function SavedForecastLinks({
  date, venue, raceNumber, records, loading, error, locked,
}: {
  date: string; venue: string; raceNumber: number; records: SavedRecordDetail[];
  loading: boolean; error: string; locked: boolean;
}) {
  const matches = records.filter(({ record }) => record?.date === date &&
    record.venueCode === venue && record.raceNumber === raceNumber);
  return <section className="panel" aria-labelledby="saved-forecast-links-heading">
    <h3 id="saved-forecast-links-heading">このレースの保存予想</h3>
    {loading && <p role="status">保存予想を読み込んでいます…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && records.length === 0 && <p>このレースの保存予想はありません。</p>}
    {!loading && !error && matches.length < records.length && <p role="status">元の記録と対象レースを照合できない保存予想があるため、該当する結果は表示を保留しています。</p>}
    {matches.length > 0 && <ul className="saved-forecast-links">
      {matches.map(({ id, record }) => <li key={id}>
        {locked
          ? <span>{record?.model?.name ?? record?.model?.profile ?? '保存予想'}</span>
          : <a href={savedRaceHref(date, venue, raceNumber, id)} data-saved-forecast-link>
            {record?.model?.name ?? record?.model?.profile ?? '保存予想'}を開く
          </a>}
        <span>　保存 {formatJstTimestamp(record?.createdAt)}</span>
        {record?.holdReasons.length ? <span>　確認保留</span> : null}
      </li>)}
    </ul>}
    {matches.length > 0 && !locked && <a href={savedRaceHref(date, venue, raceNumber)}>このレースの保存履歴を開く</a>}
  </section>;
}
