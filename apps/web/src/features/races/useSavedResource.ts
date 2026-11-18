import { useEffect, useRef, useState } from 'react';
import type { SavedPage } from '@boatrace/contracts';
import { readSaved, readSavedPages } from '../../shared/api/savedRaces';

// The key is checked during render, so an old response never flashes after selection changes.
export default function useSavedResource<T>(path: string | null, token: string, parse: (value: unknown) => T, revision: number, allPages = false) {
  const key = `${revision}:${token}:${path}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string; loading: boolean }>({ key: '', data: null, error: '', loading: false });
  const active = useRef(0);
  useEffect(() => {
    const request = ++active.current;
    if (!path || !token) return;
    const controller = new AbortController();
    setState({ key, data: null, error: '', loading: true });
    const pending = allPages
      ? readSavedPages(path, token, controller.signal, value => parse(value) as SavedPage<unknown>).then(value => value as T)
      : readSaved(path, token, controller.signal, parse);
    void pending.then(data => {
      if (!controller.signal.aborted && active.current === request) setState({ key, data, error: '', loading: false });
    }).catch(error => {
      if (!controller.signal.aborted && active.current === request) setState({ key, data: null, error: error instanceof Error ? error.message : '保存記録は未確認です。', loading: false });
    });
    return () => controller.abort();
  }, [path, token, parse, revision, key, allPages]);
  return state.key === key ? state : { key, data: null, error: '', loading: !!path && !!token };
}
