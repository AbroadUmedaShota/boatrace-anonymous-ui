import type { EvaluationSummary, LatestEvaluationResponse, PairSummary } from '@boatrace/contracts';
import { number, percent, scientific, signed, timestamp } from './format';
import { CloudCandidateNotice, CloudCandidateReferences } from './CloudCandidate';

type AvailableEvaluation = Extract<LatestEvaluationResponse, { status: 'AVAILABLE' }>;
const modelNames: Record<string, string> = {
  R3: 'R3：着順モデル',
  R5: 'R5：1・2着固定＋3着専用',
  MARKET: '市場基準：保存オッズ',
};

function Comparison({ pair, baseline, id }: { pair: PairSummary; baseline: 'R3' | 'MARKET'; id: string }) {
  return <div className="table-scroll" tabIndex={0} role="region" aria-label={`${baseline}とR5の比較`}>
    <table id={id}>
      <caption className="visually-hidden">同じ{number(pair.count)}件を使用した比較</caption>
      <thead><tr><th scope="col">モデル</th><th scope="col">全体LL ↓</th><th scope="col">3着条件付きNLL ↓</th><th scope="col">Brier和 ↓</th><th scope="col">Top-1 ↑</th></tr></thead>
      <tbody>{[baseline, 'R5'].map(key => {
        const metrics = pair.models[key];
        return <tr key={key} className={key === 'R5' ? 'current-model' : ''}>
          <th scope="row">{modelNames[key]}</th><td>{number(metrics.log_loss)}</td><td>{number(metrics.third_nll)}</td><td>{number(metrics.brier_sum)}</td><td>{percent(metrics.top1)}</td>
        </tr>;
      })}<tr className="delta-row"><th scope="row">差（R5−{baseline === 'MARKET' ? '市場' : baseline}）</th><td>{signed(pair.delta.log_loss)}</td><td>{signed(pair.delta.third_nll)}</td><td>{signed(pair.delta.brier_sum)}</td><td>{signed(pair.delta.top1 * 100)} pt</td></tr></tbody>
    </table>
  </div>;
}

function DailyComparison({ r3, market }: { r3: PairSummary; market: PairSummary }) {
  const dates = [...new Set([...r3.daily, ...market.daily].map(row => row.date))].sort();
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="日別の保存評価">
    <table id="daily-results"><thead><tr><th scope="col">開催日</th><th scope="col">R3共通件数</th><th scope="col">対R3 LL差</th><th scope="col">市場共通件数</th><th scope="col">対市場 LL差</th></tr></thead>
      <tbody>{dates.map(date => {
        const a = r3.daily.find(row => row.date === date);
        const b = market.daily.find(row => row.date === date);
        return <tr key={date}><th scope="row">{date}</th><td>{number(a?.count)}</td><td>{signed(a?.log_loss_delta)}</td><td>{number(b?.count)}</td><td>{signed(b?.log_loss_delta)}</td></tr>;
      })}</tbody>
    </table>
  </div>;
}

function Interval({ pair, title }: { pair: PairSummary; title: string }) {
  return <div className="interval-item"><h3>{title}</h3><p className="interval-value">[{signed(pair.interval.low)}, {signed(pair.interval.high)}]</p>
    <p>{pair.interval.includes_zero ? '0を含み、改善なしとも両立します。' : 'この区間だけで改善・有用性を認定しません。'}</p>
    <p className="muted">日均等平均の保存値 {signed(pair.day_balanced_delta)} / 記述的95%区間</p>
  </div>;
}

function Invariants({ value }: { value: NonNullable<EvaluationSummary['invariants']> }) {
  return <section className="panel" aria-labelledby="invariants-heading"><div className="section-title"><div><h2 id="invariants-heading">1・2着の保持確認</h2><p>機能上の確認と、予測の有用性を分けて読みます。</p></div><span className="tag">{value.prefix_passed && value.stage_loss_passed ? '保存検査：許容差内' : '保存検査：保留'}</span></div>
    <dl className="detail-grid compact">
      <div><dt>確認対象の予測数</dt><dd>{number(value.compared_forecast_count)}件</dd></div>
      <div><dt>許容差</dt><dd>{scientific(value.tolerance)}</dd></div>
      <div><dt>1着周辺確率の最大差</dt><dd>{scientific(value.first_max_absolute_delta)}</dd></div>
      <div><dt>2着周辺確率の最大差</dt><dd>{scientific(value.second_max_absolute_delta)}</dd></div>
      <div><dt>上位2艇同時確率の最大差</dt><dd>{scientific(value.ordered_pair_max_absolute_delta)}</dd></div>
      <div><dt>1着の段階LL差</dt><dd>{scientific(value.stage_log_loss_delta[0])}</dd></div>
      <div><dt>2着の条件付きLL差</dt><dd>{scientific(value.stage_log_loss_delta[1])}</dd></div>
      <div><dt>3着の条件付きLL差</dt><dd>{signed(value.stage_log_loss_delta[2])}</dd></div>
    </dl><p className="muted">微小な差は指数表記で保持しています。0は保存値が0の場合だけです。</p>
  </section>;
}

export default function EvaluationView({ value }: { value: AvailableEvaluation }) {
  const summary = value.summary;
  const { period, invariants } = summary;
  const { r3, market } = summary.paired;
  if (!period || !r3 || !market || !invariants) return <div className="state-panel error" role="alert">表示に必要な保存資料が不足しています。数値は未確認です。</div>;

  return <div id="evaluation-view">
    {value.source_type === 'CLOUD_VIEW' && <CloudCandidateNotice />}
    <section className="panel evaluation-overview" aria-labelledby="evaluation-heading">
      <div className="section-title"><div><h2 id="evaluation-heading">R5モデルの保存済み評価</h2><p>1・2着固定＋3着専用モデル</p></div><span className="tag warning">結果既知・過去診断</span></div>
      <div className="period-line"><strong>{period.start.replaceAll('-', '/')} <span>—</span> {period.end.replaceAll('-', '/')}</strong><span>固定{number(period.days)}日間</span></div>
      <div className="notice warning"><strong>新しい未見の前向き評価ではありません。</strong><p>モデルは評価期間より後に作成されています。当時利用できた予想・将来の的中実績や収益性の証明にはなりません。運用・購入の適格性は保留です。</p></div>
      <dl className="detail-grid overview-details"><div><dt>モデル作成（JST）</dt><dd>{timestamp(summary.model_created_at)}</dd></div><div><dt>モデル学習完了（JST）</dt><dd>{timestamp(summary.model_fitted_at)}</dd></div><div><dt>評価記録作成（JST）</dt><dd>{timestamp(summary.created_at)}</dd></div></dl>
    </section>

    <section className="panel" aria-labelledby="r3-heading"><div className="section-title"><div><h2 id="r3-heading">R3との比較</h2><p>同じ正常レースを使った比較</p></div><span className="cohort-count" id="r3-count"><strong>{number(r3.count)}</strong>件</span></div>
      <Comparison pair={r3} baseline="R3" id="r3-results" />
      <p className="comparison-note">3着条件付きNLL差 <strong>{signed(r3.delta.third_nll)}</strong> / Top-1差 <strong>{signed(r3.delta.top1 * 100)}ポイント</strong>。指標ごとの変化を分けて確認し、改善の確立とは判断しません。</p>
    </section>

    <section className="panel" aria-labelledby="market-heading"><div className="section-title"><div><h2 id="market-heading">市場基準との比較</h2><p>保存された締切前履歴オッズの逆数正規化</p></div><span className="cohort-count" id="market-count"><strong>{number(market.count)}</strong>件</span></div>
      <Comparison pair={market} baseline="MARKET" id="market-results" />
      <p className="comparison-note">R3比較とは対象件数が異なります。市場との全体LL差 <strong>{signed(market.delta.log_loss)}</strong>。市場を超える予測改善は確立していません。</p><p className="muted">保存されたオッズによる参考比較です。厳密な同時点の利用可能性は未確立です。</p>
    </section>

    <section className="panel metric-guide" aria-labelledby="metric-guide-heading"><h2 id="metric-guide-heading">指標の読み方</h2><dl><div><dt>LL・3着条件付きNLL ↓</dt><dd>対数損失。小さいほど良く、差がマイナスなら損失が減っています。</dd></div><div><dt>Brier和 ↓</dt><dd>120通りの確率について、予測と結果の二乗誤差を足した値。小さいほど良い指標です。</dd></div><div><dt>Top-1 ↑</dt><dd>最大確率の3連単1点が結果と一致した割合。大きいほど良く、差のptはパーセントポイントです。</dd></div></dl><p className="muted">指標は保存値の表示桁だけを整えています。率から的中件数を逆算せず、評価の再計算も行いません。</p></section>

    <section className="panel" aria-labelledby="daily-heading"><div className="section-title"><div><h2 id="daily-heading">固定期間の日別結果</h2><p>全体LL差（R5−比較対象）。件数と差は各比較の保存値です。</p></div></div><DailyComparison r3={r3} market={market} /></section>

    <section className="panel" aria-labelledby="interval-heading"><div className="section-title"><div><h2 id="interval-heading">日ごとの変動と記述的区間</h2><p>既知日の平均を再標本化した参考要約</p></div><span className="tag">正式な有意差検定ではありません</span></div><div className="interval-grid"><Interval pair={r3} title="R5−R3の全体LL差" /><Interval pair={market} title="R5−市場の全体LL差" /></div><p className="muted">既知{number(period.days)}日からの日平均再標本化による近似です。将来の改善・有意差・収益性を証明しません。新しいモデル・期間の選び直しには使いません。</p></section>
    <Invariants value={invariants} />

    <section className="panel quiet" aria-labelledby="identity-heading"><h2 id="identity-heading">保存記録の識別情報</h2><dl className="identity-list"><dt>評価ID</dt><dd id="evaluation-id"><code>{value.evaluation_id}</code></dd><dt>モデルSHA256</dt><dd id="model-sha"><code>{summary.model_sha256}</code></dd><dt>保存資料の区分</dt><dd>結果既知：{summary.known_results ? 'はい' : '未確認'} / 新しい未見評価：{summary.new_holdout ? 'はい' : 'いいえ'}</dd><dt>利用の受入</dt><dd>予測有用性・運用・購入は保留。画面表示は指定レビュー・プロジェクト責任者による利用開始判断の代用ではありません。</dd></dl>{value.source_type === 'CLOUD_VIEW' ? <CloudCandidateReferences provenance={value.provenance} /> : <details><summary>移行元と保存証跡を確認（PC内のローカル資料）</summary><pre>{JSON.stringify(value.provenance, null, 2)}</pre></details>}</section>
  </div>;
}
