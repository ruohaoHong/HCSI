import type { SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import type { SemanticSensorObservationRecordV1 } from './semantic-sensor-observation-record-v1'
import { fitCategoricalConfusionModel,type SemanticConfusionModelV1 } from './semantic-confusion-model-v1'
import type { SemanticFeatureId } from './semantic-taxonomy-v1'
export interface CandidateCalibrationFit {status:'candidate_artifact'|'insufficient_data';feature_id:SemanticFeatureId;dataset_id:string;dataset_version:string;split:'calibration';estimator_locked:true;model:SemanticConfusionModelV1|null;reason_codes:string[]}
export function fitSemanticCalibrationArtifact(dataset:SemanticCalibrationDatasetV1,records:readonly SemanticSensorObservationRecordV1[],feature_id:SemanticFeatureId):CandidateCalibrationFit{
 const specimens=new Set(dataset.specimens.filter(s=>s.images.some(i=>i.split==='calibration')).map(s=>s.specimen_id));const rs=records.filter(r=>specimens.has(r.specimen_id)&&r.feature_id===feature_id)
 const truth=Object.fromEntries(dataset.specimens.filter(s=>specimens.has(s.specimen_id)).flatMap(s=>s.ground_truth.filter(g=>g.feature_id===feature_id).map(g=>[s.specimen_id,g.value])))
 if(!rs.length||!Object.keys(truth).length)return {status:'insufficient_data',feature_id,dataset_id:dataset.dataset_id,dataset_version:dataset.dataset_version,split:'calibration',estimator_locked:true,model:null,reason_codes:['calibration_split_support_missing']}
 return {status:'candidate_artifact',feature_id,dataset_id:dataset.dataset_id,dataset_version:dataset.dataset_version,split:'calibration',estimator_locked:true,model:fitCategoricalConfusionModel(feature_id,rs,truth),reason_codes:[]}
}
