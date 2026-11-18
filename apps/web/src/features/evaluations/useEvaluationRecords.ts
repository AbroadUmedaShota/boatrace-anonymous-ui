import { useState } from 'react';
import type { EvaluationListResponse, EvaluationDetailResponse } from '@boatrace/contracts';
import { readEvaluationList, readEvaluationDetail, readEvaluationSession } from '../../shared/api/evaluations';
import type { ConnectionProps } from '../../shared/ui/ConnectionForm';

export default function useEvaluationRecords({ token, onBusyChange, onIdentity }: ConnectionProps, admin = false) {
  const [list, setList] = useState<EvaluationListResponse | null>(null);
  const [detail, setDetail] = useState<EvaluationDetailResponse | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function clear() { setList(null); setDetail(null); setSelectedId(''); setError(''); }

  async function loadList(cursor?: string) {
    if (busy || !token.trim()) return;
    clear(); setBusy(true); onBusyChange(true);
    try {
      const value = await readEvaluationList(token.trim(), admin, cursor);
      if (value.items.some(item => item.source_type === 'CLOUD_VIEW')) onIdentity?.(await readEvaluationSession(token.trim()));
      setList(value);
    }
    catch (error) { onIdentity?.(null); setError(error instanceof Error ? error.message : '保存一覧は未確認です。'); }
    finally { setBusy(false); onBusyChange(false); }
  }

  async function loadDetail(id: string) {
    if (busy || !token.trim()) return;
    setDetail(null); setError(''); setSelectedId(id); setBusy(true); onBusyChange(true);
    try {
      const value = await readEvaluationDetail(token.trim(), id);
      if (value.source_type === 'CLOUD_VIEW') onIdentity?.(await readEvaluationSession(token.trim()));
      if (value.status === 'HELD') setList(null);
      setDetail(value);
    }
    catch (error) { onIdentity?.(null); setList(null); setError(error instanceof Error ? error.message : '保存詳細は未確認です。'); }
    finally { setBusy(false); onBusyChange(false); }
  }

  return { list, detail, selectedId, busy, error, clear, loadList, loadDetail };
}
