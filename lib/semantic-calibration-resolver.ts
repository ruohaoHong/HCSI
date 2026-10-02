import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import type { SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { validateSemanticCalibrationDataset } from './semantic-calibration-dataset-v1'
import type { SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'
import { assessSemanticLikelihoodEligibility } from './semantic-likelihood-eligibility'
import type { SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'
import type { SemanticCalibrationRegistryEntry } from './semantic-calibration-registry'

export const SEMANTIC_CALIBRATION_RESOLVER_SCHEMA='hcsi.semantic-calibration-resolver.v1' as const
export type CalibrationResolutionStatus=
  |'resolved'
  |'no_matching_artifact'
  |'identity_mismatch'
  |'out_of_scope'
  |'policy_ineligible'
  |'ambiguous_multiple_artifacts'
  |'dataset_invalid'

export interface CalibrationResolution {
  schema_version:typeof SEMANTIC_CALIBRATION_RESOLVER_SCHEMA
  status:CalibrationResolutionStatus
  artifact:SemanticCalibrationArtifactV1|null
  dataset:SemanticCalibrationDatasetV1|null
  reason_codes:string[]
}

export function calibrationArtifactIdentityMatches(r:SemanticRuntimeCalibrationContext,a:SemanticCalibrationArtifactV1){
  const i=a.sensor_identity
  return a.feature_id===r.feature_id&&
    i.sensor_type===r.sensor_type&&
    i.model===r.model&&
    i.model_version===r.model_version&&
    i.prompt_version===r.prompt_version&&
    i.extractor_version===r.extractor_version&&
    a.taxonomy_version===r.taxonomy_version
}

function scopeMatch(r:SemanticRuntimeCalibrationContext,a:SemanticCalibrationArtifactV1){
  const q=r.quality,s=a.applicability_scope
  if(q.width_px===null||q.height_px===null) return false
  return s.visibility.includes(q.visibility)&&
    s.capture_types.includes(q.capture_type)&&
    s.viewpoints.includes(q.viewpoint)&&
    s.crop_types.includes(q.crop_type)&&
    s.occlusion_conditions.includes(q.occlusion_condition)&&
    s.glare_conditions.includes(q.glare_condition)&&
    q.width_px>=s.resolution.min_width_px&&q.height_px>=s.resolution.min_height_px&&
    (s.resolution.max_width_px===null||q.width_px<=s.resolution.max_width_px)&&
    (s.resolution.max_height_px===null||q.height_px<=s.resolution.max_height_px)
}

export function calibrationRegistryEntryMatchesRuntime(e:SemanticCalibrationRegistryEntry,r:SemanticRuntimeCalibrationContext){
  return e.feature_id===r.feature_id&&e.sensor_type===r.sensor_type&&e.model===r.model&&
    e.model_version===r.model_version&&e.prompt_version===r.prompt_version&&
    e.extractor_version===r.extractor_version&&e.taxonomy_version===r.taxonomy_version
}

export function exactIdentityArtifacts(
  runtime:SemanticRuntimeCalibrationContext,
  artifacts:readonly SemanticCalibrationArtifactV1[],
):SemanticCalibrationArtifactV1[]{
  return artifacts.filter(artifact=>calibrationArtifactIdentityMatches(runtime,artifact))
}

export function selectExplicitActiveArtifact(
  runtime:SemanticRuntimeCalibrationContext,
  identityCompatibleArtifacts:readonly SemanticCalibrationArtifactV1[],
  registry:readonly SemanticCalibrationRegistryEntry[],
  policyVersion:string,
):{status:'selected'|'not_active'|'ambiguous';artifact:SemanticCalibrationArtifactV1|null}{
  const entries=registry.filter(entry=>calibrationRegistryEntryMatchesRuntime(entry,runtime)&&entry.policy_version===policyVersion)
  if(entries.length!==1) return {status:entries.length>1?'ambiguous':'not_active',artifact:null}
  const entry=entries[0]
  const selected=identityCompatibleArtifacts.filter(a=>
    a.calibration_id===entry.active_calibration_id&&a.version===entry.active_version
  )
  return {status:selected.length===1?'selected':selected.length>1?'ambiguous':'not_active',artifact:selected.length===1?selected[0]:null}
}

export function resolveSemanticCalibrationArtifact(
  runtime:SemanticRuntimeCalibrationContext,
  admittedArtifacts:readonly SemanticCalibrationArtifactV1[],
  datasets:readonly SemanticCalibrationDatasetV1[],
  activePolicy:SemanticCalibrationEligibilityPolicyV1|null,
  registry:readonly SemanticCalibrationRegistryEntry[],
):CalibrationResolution{
  const broad=admittedArtifacts.filter(a=>a.feature_id===runtime.feature_id&&a.sensor_identity.sensor_type===runtime.sensor_type)
  const identity=admittedArtifacts.filter(a=>calibrationArtifactIdentityMatches(runtime,a))
  if(!identity.length){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,
      status:broad.length?'identity_mismatch':'no_matching_artifact',
      artifact:null,dataset:null,
      reason_codes:['no_applicable_validated_calibration_artifact','no_exact_identity_match'],
    }
  }

  const scoped=identity.filter(a=>scopeMatch(runtime,a))
  if(!scoped.length){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,status:'out_of_scope',
      artifact:null,dataset:null,
      reason_codes:[
        'no_applicable_validated_calibration_artifact',
        runtime.quality.width_px===null||runtime.quality.height_px===null||
        runtime.quality.capture_type==='unknown'||runtime.quality.viewpoint==='unknown'||runtime.quality.crop_type==='unknown'
          ?'runtime_quality_unknown':'runtime_quality_out_of_scope',
      ],
    }
  }

  if(!activePolicy||activePolicy.status!=='preregistered'){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,status:'policy_ineligible',
      artifact:null,dataset:null,
      reason_codes:['no_applicable_validated_calibration_artifact','active_preregistered_policy_missing'],
    }
  }

  const runtimeEntries=registry.filter(e=>calibrationRegistryEntryMatchesRuntime(e,runtime))
  if(runtimeEntries.length>1){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,status:'ambiguous_multiple_artifacts',
      artifact:null,dataset:null,reason_codes:['multiple_active_registry_entries'],
    }
  }
  if(!runtimeEntries.length){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,
      status:scoped.length>1?'ambiguous_multiple_artifacts':'policy_ineligible',
      artifact:null,dataset:null,
      reason_codes:[
        scoped.length>1?'ambiguous_multiple_artifacts':'artifact_not_active_in_registry',
        'no_applicable_validated_calibration_artifact',
      ],
    }
  }

  const active=runtimeEntries[0]
  if(active.policy_version!==activePolicy.policy_version){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,status:'policy_ineligible',
      artifact:null,dataset:null,reason_codes:['registry_policy_version_mismatch','no_applicable_validated_calibration_artifact'],
    }
  }
  const selected=scoped.filter(a=>a.calibration_id===active.active_calibration_id&&a.version===active.active_version)
  if(selected.length!==1){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,
      status:selected.length>1?'ambiguous_multiple_artifacts':'policy_ineligible',
      artifact:null,dataset:null,
      reason_codes:[selected.length>1?'duplicate_active_artifact_identity':'active_registry_artifact_not_found','no_applicable_validated_calibration_artifact'],
    }
  }

  const artifact=selected[0]
  const dataset=datasets.find(d=>
    d.dataset_id===artifact.dataset_id&&
    d.dataset_version===artifact.dataset_version&&
    d.manifest_digest_sha256===artifact.dataset_manifest_digest_sha256&&
    d.dataset_content_digest_sha256===artifact.dataset_content_digest_sha256
  )??null
  const validation=dataset?validateSemanticCalibrationDataset(dataset):null
  if(!dataset||!validation?.valid||!validation.production_eligible_source){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,status:'dataset_invalid',
      artifact:null,dataset,reason_codes:['active_artifact_dataset_invalid_or_ineligible','no_applicable_validated_calibration_artifact'],
    }
  }

  const eligibility=assessSemanticLikelihoodEligibility(runtime,artifact,dataset,validation,activePolicy)
  if(!eligibility.likelihood_eligible){
    return {
      schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,
      status:eligibility.calibration_applicability==='out_of_scope'?'out_of_scope':
        eligibility.calibration_applicability==='mismatch'?'identity_mismatch':'policy_ineligible',
      artifact:null,dataset:null,
      reason_codes:[...new Set(['no_applicable_validated_calibration_artifact',...eligibility.reason_codes])],
    }
  }

  return {
    schema_version:SEMANTIC_CALIBRATION_RESOLVER_SCHEMA,status:'resolved',
    artifact,dataset,reason_codes:[],
  }
}
