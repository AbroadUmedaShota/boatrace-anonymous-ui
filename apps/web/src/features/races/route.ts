import { useEffect, useState } from 'react';
import type { Page } from '../../shared/ui/AppShell';

export type RaceSelection = { date: string; venue: string; race: string; record: string };
export type PortalRoute = RaceSelection & { page: Page };
const empty = { date: '', venue: '', race: '', record: '' };

function readRoute(): PortalRoute {
  const [name, query = ''] = window.location.hash.slice(1).split('?');
  const page: Page = ['forecast', 'races', 'predictions', 'latest', 'history', 'admin'].includes(name) ? name as Page : 'forecast';
  const params = new URLSearchParams(query);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : '';
  const venue = date && /^\d{2}$/.test(params.get('venue') ?? '') ? params.get('venue')! : '';
  const race = venue ? params.get('race') ?? '' : '';
  const record = page === 'forecast' ? params.get('job') ?? '' : race ? params.get('record') ?? '' : '';
  return { page, date, venue, race, record };
}

export function usePortalRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update); };
  }, []);
  function navigate(next: PortalRoute) {
    const params = new URLSearchParams();
    if (next.page === 'races') for (const key of ['date', 'venue', 'race', 'record'] as const) if (next[key]) params.set(key, next[key]);
    if (next.page === 'forecast' && next.record) params.set('job', next.record);
    const hash = `#${next.page}${params.size ? `?${params}` : ''}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    setRoute(next);
  }
  return { route, navigate, navigatePage: (page: Page) => navigate({ ...empty, page }) };
}
