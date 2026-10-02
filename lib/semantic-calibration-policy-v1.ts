import type { CalibrationDatasetSourceScope } from './semantic-calibration-dataset-v1'

export const SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA='hcsi.semantic-calibration-eligibility-policy.v1' as const
export interface SemanticCalibrationEligibilityPolicyV1 {
 schema_version:typeof SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_SCHEMA
 policy_id:string;policy_version:string;status:'draft_not_preregistered'|'preregistered'|'retired'
 created_at:string;locked_at:string|null
 applicable_dataset_schema:string;applicable_calibration_schema:string
 allowed_source_scopes:CalibrationDatasetSourceScope[]
 required_split_policy:{unit:'physical_specimen';calibration_required:boolean;validation_required:boolean}
 required_gt_policy:{independently_verified:true;same_sensor_self_label_forbidden:true;provenance_required:true}
 minimum_support:{sample_count:number|null;per_class:number|null}
 metric_requirements:{max_brier_score:number|null;max_log_loss:number|null;max_ece:number|null}
 quality_coverage_requirements:{required:boolean;description:string}
 artifact_identity_requirements:{exact_sensor_identity:true;exact_feature:true;exact_taxonomy:true}
 admission_rules:string[];change_control:{requires_new_version:true;validation_set_must_not_tune_estimator:true}
}
export const SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY:readonly SemanticCalibrationEligibilityPolicyV1[]=[]
export const ACTIVE_SEMANTIC_CALIBRATION_POLICY:SemanticCalibrationEligibilityPolicyV1|null=null
