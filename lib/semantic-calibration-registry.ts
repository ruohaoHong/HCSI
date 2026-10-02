import type { SemanticFeatureId } from './semantic-taxonomy-v1'
import type { SemanticSensorType } from './semantic-evidence-v1'
import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'

export interface SemanticCalibrationRegistryEntry {
 feature_id:SemanticFeatureId;sensor_type:SemanticSensorType;model:string;model_version:string;prompt_version:string;extractor_version:string;taxonomy_version:string
 active_calibration_id:string;active_version:string;policy_version:string
}
export const ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS:readonly SemanticCalibrationArtifactV1[]=[]
export const SEMANTIC_CALIBRATION_REGISTRY:readonly SemanticCalibrationRegistryEntry[]=[]
