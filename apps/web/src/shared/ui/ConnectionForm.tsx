import { useEffect, useRef, type FormEvent } from 'react';
import { accessBrowserMode, type BrowserSession } from '../api/browserAuth';


const authenticationLabels: Record<BrowserSession['authentication'], string> = {
  ACCESS_PRODUCTION_CANDIDATE: 'Cloudflare Access接続候補（実接続は未検証）',
  LOCAL_SIGNED_TOKEN: 'ローカル署名トークン',
  ACCESS_COMPATIBLE_LOCAL_FIXTURE: 'Access互換RS256のローカルfixture検証',
  ACCESS_HTTPS_JWKS_LOCAL_INTEGRATION: 'HTTPS JWKS取得adapterのローカル統合検証（応答は匿名fixture）',
};

export type ConnectionProps = { token: string; onTokenChange: (token: string) => void; onBusyChange: (busy: boolean) => void; identity?: BrowserSession | null; onIdentity?: (identity: BrowserSession | null) => void };

export default function ConnectionForm({ token, onTokenChange, onSubmit, busy, identity, compact = false, title = '閲覧トークンで接続', button = '保存済み評価を読む' }: {
  token: string; onTokenChange: (token: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean; identity?: BrowserSession | null; compact?: boolean; title?: string; button?: string;
}) {
  const accessForm=useRef<HTMLFormElement>(null);const initialized=useRef(false);
  useEffect(()=>{if(!accessBrowserMode||!token||initialized.current)return;const timer=window.setTimeout(()=>{initialized.current=true;accessForm.current?.requestSubmit();},0);return()=>window.clearTimeout(timer);},[token]);
  if(accessBrowserMode)return <section className="panel connection-panel"><h2>ログイン状態</h2><p id="authentication-mode">{identity?`サーバー確認済み：${authenticationLabels[identity.authentication]} / 権限：${identity.role}`:'認証方式・権限を確認しています。'}</p><p>ブラウザーのAccessセッションを利用します。実Cloudflare接続・公開先での認証は未検証です。</p><form ref={accessForm} onSubmit={onSubmit}><button type="submit" disabled={busy||!token}>{busy?'確認しています…':'接続状態を再確認'}</button></form><a href="/">ログイン画面へ戻る</a></section>;
  const localForm=<section className="panel connection-panel" aria-labelledby="connection-heading"><div><h2 id="connection-heading">{title}</h2><p id="token-help">トークンはこの画面のメモリだけに保持します。URLやブラウザーの保存領域には記録しません。</p></div>
    <p id="authentication-mode" className="notice neutral" role="status">{identity ? <>サーバー確認済み：{authenticationLabels[identity.authentication]} / 権限：{identity.role}</> : '認証方式・権限は未確認です。'}<br />実Cloudflare Access・公開先ホストでの認証は未検証です。この画面からログイン提供者を設定しません。</p>
    <form onSubmit={onSubmit} aria-busy={busy}><label htmlFor="viewer-token">接続トークン<input id="viewer-token" type="password" value={token} onChange={event => onTokenChange(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="token-help" disabled={busy} required placeholder="発行されたトークン" /></label><button type="submit" disabled={busy || !token.trim()}>{busy ? '読み込み中…' : button}</button></form>
  </section>;
  return compact ? <details className="local-connection-disclosure" key={identity?'verified':'unverified'} open={!identity}><summary>{identity?'接続済み・閲覧権限':'ローカル環境への接続'}</summary>{localForm}</details> : localForm;
}
