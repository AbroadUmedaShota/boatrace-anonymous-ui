import ForecastWorkspace from '../forecast/ForecastWorkspace';
import { useEffect, useState } from 'react';
import { accessBrowserMode, ACCESS_CONNECTION, type BrowserSession } from '../../shared/api/browserAuth';
import { readEvaluationSession } from '../../shared/api/evaluations';
import AppShell from '../../shared/ui/AppShell';
import SavedRaceWorkspace from '../races/SavedRaceWorkspace';
import PredictionHistory from '../predictions/PredictionHistory';
import { usePortalRoute } from '../races/route';
import EvaluationWorkspace from './EvaluationWorkspace';
import EvaluationHistory from './EvaluationHistory';
import EvaluationAdmin from '../admin/EvaluationAdmin';

export default function EvaluationPortal() {
  const { route, navigate, navigatePage } = usePortalRoute();
  const page = route.page;
  const [token, setToken] = useState('');
  const [identity, setIdentity] = useState<BrowserSession | null>(null);
  const [sessionError,setSessionError]=useState('');
  useEffect(()=>{if(!accessBrowserMode)return;let active=true;const invalid=()=>{setIdentity(null);setToken('');setSessionError('ログインが無効または期限切れです。再度ログインしてください。');};window.addEventListener('boat-access-session-invalid',invalid);void readEvaluationSession(ACCESS_CONNECTION).then(value=>{if(active){setIdentity(value);setToken(ACCESS_CONNECTION);}}).catch(error=>{if(active){setIdentity(null);setToken('');setSessionError(error instanceof Error?error.message:'ログイン状態を確認できません。');}});return()=>{active=false;window.removeEventListener('boat-access-session-invalid',invalid);};},[]);
  const [busy, setBusy] = useState(false);
  const connection = { token, onTokenChange: (value: string) => { setToken(value); setIdentity(null); }, onBusyChange: setBusy, identity, onIdentity: setIdentity };
  return <AppShell page={page} onNavigate={navigatePage} busy={busy} administrator={identity?.role==='admin'} showingJob={page==='forecast' && !!route.record}>
    {accessBrowserMode&&!token ? <section className="state-panel"><p role={sessionError?'alert':'status'}>{sessionError||'ログイン状態を確認しています…'}</p>{sessionError&&<a href="/">ログイン画面へ戻る</a>}</section> : page === 'forecast' ? <ForecastWorkspace {...connection} jobId={route.record} onJob={record => navigate({ ...route, record })} /> : page === 'predictions' ? <PredictionHistory {...connection} onOpenPrediction={record => navigate({ ...route, page: 'forecast', record })} /> : page === 'races' ? <SavedRaceWorkspace {...connection} selection={route} onSelect={selection => navigate({ page: 'races', ...selection })} /> : page === 'latest' ? <EvaluationWorkspace {...connection} /> : page === 'history' ? <EvaluationHistory {...connection} /> : <EvaluationAdmin {...connection} />}
  </AppShell>;
}
