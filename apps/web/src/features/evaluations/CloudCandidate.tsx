const referenceNames: Record<string, string> = {
  transfer_sha256: '元転送資料の照合hash', summary_sha256: '保存集計の元JSON hash',
  model_sha256: 'モデルの照合hash', report_sha256: '評価報告の照合hash',
  evaluation_seal_sha256: '評価封印の照合hash', forecast_seal_sha256: '予測封印の照合hash',
  protocol_sha256: '評価手順の照合hash', model_protocol_sha256: 'モデル手順の照合hash',
  evaluation_claim_sha256: '評価実行記録の照合hash',
};

export function sourceLabel(source?: 'CLOUD_VIEW' | 'LEGACY_TRANSFER') {
  return source === 'CLOUD_VIEW' ? 'クラウド向け候補（ローカル検証）' : '従来のローカル転送形式';
}

export function CloudCandidateNotice() {
  return <div id="cloud-candidate-notice" className="notice warning cloud-candidate-notice" role="note"><strong>クラウド向け候補 / ローカル検証・公開未承認</strong><p>この環境で読み込める候補です。AVAILABLE・閲覧可という状態は、実Cloudflareへの公開やユーザーへの共有許諾を意味しません。原本や非公開の出典資料はPC内に残します。</p></div>;
}

export function CloudCandidateReferences({ provenance }: { provenance: Record<string, unknown> }) {
  const references = provenance.references as Record<string, string>;
  return <div id="cloud-safe-references">
    <p className="muted">照合用のopaque hashだけを表示します。元HTML・出走艇・個別レースの対象集合・モデル本体・鍵・PCの保存先は含めません。</p>
    <dl className="identity-list cloud-reference-list">{Object.entries(referenceNames).map(([key, label]) => <div key={key}><dt>{label}</dt><dd><code data-cloud-reference={key}>{references[key]}</code></dd></div>)}</dl>
    <p className="notice warning">公開可否：未承認（release_allowed=false） / 利用条件の承認：UNKNOWN</p>
    <details><summary>保存集計の元JSON文字列を確認</summary><p className="muted">集計summaryだけの元字句です。非公開provenanceや元APIの内部資料ではありません。上の表示は保存値の桁だけを整え、再計算していません。</p><pre id="cloud-summary-text">{String(provenance.summary_json_utf8)}</pre></details>
  </div>;
}
