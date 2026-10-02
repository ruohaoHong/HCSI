import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorObservationRecordV1 } from './semantic-sensor-observation-record-v1'
export const SEMANTIC_CONFUSION_MODEL_SCHEMA='hcsi.semantic-confusion-model.v1' as const
export interface SemanticConfusionModelV1 {schema_version:typeof SEMANTIC_CONFUSION_MODEL_SCHEMA;feature_id:SemanticFeatureId;estimator:{method:'empirical_counts';smoothing:'none'};counts:Record<string,Record<string,number>>;row_totals:Record<string,number>;empirical_frequencies:Record<string,Record<string,number>>;outcomes:string[]}
export function fitCategoricalConfusionModel(feature_id:SemanticFeatureId,records:readonly SemanticSensorObservationRecordV1[],truth:Readonly<Record<string,string>>):SemanticConfusionModelV1{
 const counts:Record<string,Record<string,number>>={},outcomes=new Set<string>()
 for(const r of records.filter(x=>x.feature_id===feature_id)){const gt=truth[r.specimen_id];if(!gt)continue;const outcome=['unknown','ambiguous','not_visible','open_set','not_observed'].includes(r.state)?r.state:r.value;outcomes.add(outcome);counts[gt]??={};counts[gt][outcome]=(counts[gt][outcome]??0)+1}
 const row_totals=Object.fromEntries(Object.entries(counts).map(([g,row])=>[g,Object.values(row).reduce((a,b)=>a+b,0)]))
 const empirical_frequencies=Object.fromEntries(Object.entries(counts).map(([g,row])=>[g,Object.fromEntries(Object.entries(row).map(([o,n])=>[o,n/row_totals[g]]))]))
 return {schema_version:SEMANTIC_CONFUSION_MODEL_SCHEMA,feature_id,estimator:{method:'empirical_counts',smoothing:'none'},counts,row_totals,empirical_frequencies,outcomes:[...outcomes].sort()}
}
export function requireRawScoreForScoreCalibrator(score:number|null){if(score===null)throw new Error('raw_score_required_for_score_calibrator');return score}
