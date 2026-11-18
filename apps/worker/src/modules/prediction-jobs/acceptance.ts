import type {Bindings} from '../../composition';
/** Closing admission must not reserve rows or stop callbacks already in progress. */
export function predictionAcceptanceEnabled(env:Pick<Bindings,'PREDICTION_ACCEPTANCE_ENABLED'|'LOCAL_ONLY'|'AUTH_MODE'>){
 if(env.PREDICTION_ACCEPTANCE_ENABLED==='true')return true;
 return env.PREDICTION_ACCEPTANCE_ENABLED===undefined&&env.LOCAL_ONLY==='true'&&env.AUTH_MODE!=='ACCESS_PRODUCTION_RS256';
}
