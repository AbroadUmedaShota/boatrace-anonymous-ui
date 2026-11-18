import { useEffect, useRef, type ReactNode } from 'react';

export type Page = 'forecast' | 'predictions' | 'races' | 'latest' | 'history' | 'admin';
const pages = {
  forecast: { title: 'レースを選ぶ', description: '日付・競艇場・レース番号を選ぶと、予想の受付状況と過去の結果を確認できます。' },
  predictions: { title: '予想履歴', description: '過去の依頼を選んで、受付状況や保存された予想結果を開きます。' },
  races: { title: '保存レース', description: '日付・競艇場・レースから、保存時点の予想と参考情報を確認する' },
  latest: { title: 'モデル評価', description: '比較の条件と数値を、保存時点の記録から確認する' },
  history: { title: 'モデル評価履歴', description: '閲覧できる保存評価を選び、期間と比較条件を確認する' },
  admin: { title: '評価の管理', description: '登録状態・閲覧許可・最新の指定を、それぞれ確認する' },
};

export default function AppShell({ children, page = 'forecast', onNavigate, busy = false, administrator=false, showingJob=false }: { children: ReactNode; page?: Page; onNavigate?: (page: Page) => void; busy?: boolean; administrator?:boolean; showingJob?:boolean }) {
  const main = useRef<HTMLElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) {
      main.current?.focus();
      previousPage.current = page;
    }
  }, [page]);
  function navButton(item: Page) {
    return <button key={item} id={`nav-${item}`} type="button" aria-current={page === item ? 'page' : undefined}
      disabled={busy} onClick={() => onNavigate?.(item)}>{pages[item].title}</button>;
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>本文へ移動</a>
    <aside className="sidebar">
      <div className="brand"><span aria-hidden="true" className="brand-mark">≋</span><span>レース予想</span></div>
      <nav aria-label="レースと予想">{(['forecast', 'predictions', 'races'] as const).map(navButton)}</nav>
      <nav aria-label="モデル評価と管理" className="evaluation-nav">{(['latest', 'history'] as const).map(navButton)}{administrator && navButton('admin')}</nav>
      <div className="sidebar-note"><span className="local-dot" aria-hidden="true" />ローカル検証版<p>管理操作には管理者権限が必要<br />実投票・自動購入は対象外</p></div>
    </aside>
    <main ref={main} id="main-content" tabIndex={-1}>
      <header className="page-heading"><div><h1>{showingJob ? '予想の詳細' : pages[page].title}</h1><p>{showingJob ? '選んだ依頼の受付状況と予想結果を確認できます。' : pages[page].description}</p></div><span className="read-only-label">{page === 'races' ? '保存参照・明示操作' : page === 'admin' || page === 'forecast' ? '操作前に内容を確認' : '読み取り専用'}</span></header>
      {showingJob && <button type="button" className="secondary small" disabled={busy} onClick={() => onNavigate?.('predictions')}>予想履歴を開く</button>}
      {children}
      <footer><span>ローカル検証 / 日時は各欄のタイムゾーン表記に従います</span><span>アプリの動作と予測の有用性は別に評価</span></footer>
    </main>
  </div>;
}
