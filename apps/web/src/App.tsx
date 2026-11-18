import EvaluationPortal from './features/evaluations/EvaluationPortal';

const anonymousOwnerTrial = (import.meta as ImportMeta & {env?:Record<string,string>}).env?.VITE_BOAT_RELEASE_PROFILE === 'ANONYMOUS_OWNER_TRIAL';

export default function App() {
  return <>
    {anonymousOwnerTrial && <p className="notice" role="note" data-release-profile="ANONYMOUS_OWNER_TRIAL">合成データによる接続試験です。実レースの予想結果ではありません。</p>}
    <EvaluationPortal />
  </>;
}
