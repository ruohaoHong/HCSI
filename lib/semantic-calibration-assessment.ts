import type { SemanticEvidenceV1, SemanticObservation, SemanticSensorType } from './semantic-evidence-v1'
import type { TargetedSemanticEvidence } from './targeted-semantic-extractor'
import type { SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import type { SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import type { SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'
import type { SemanticCalibrationRegistryEntry } from './semantic-calibration-registry'
import {
  resolveSemanticCalibrationArtifact,
  type CalibrationResolutionStatus,
} from './semantic-calibration-resolver'
import {
  buildSemanticRuntimeQuality,
  semanticObservationQualityMetadata,
  type SemanticRuntimeQualityContext,
} from './semantic-runtime-quality'
import type { SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'

export const SEMANTIC_CALIBRATION_ASSESSMENT_SCHEMA='hcsi.semantic-calibration-assessment.v1' as const

export interface SemanticCalibrationAssessmentItem {
  observation_ref:string
  feature_id:string
  source:string
  independence_group:string
  calibration_status:'validated'|'unavailable'|'mismatch'|'out_of_scope'
  calibration_resolution_status:CalibrationResolutionStatus
  calibration_artifact_id:string|null
  raw_score:number|null
  calibrated_distribution:Record<string,number>|null
  calibrated_probability:number|null
  likelihood_eligible:boolean
  runtime_quality:SemanticRuntimeQualityContext
  reason_codes:string[]
}

export interface SemanticCalibrationAssessment {
  schema_version:typeof SEMANTIC_CALIBRATION_ASSESSMENT_SCHEMA
  available:boolean
  items:SemanticCalibrationAssessmentItem[]
}

export interface SemanticCalibrationAssessmentEnvironment {
  artifacts:readonly SemanticCalibrationArtifactV1[]
  datasets:readonly SemanticCalibrationDatasetV1[]
  active_policy:SemanticCalibrationEligibilityPolicyV1|null
  registry:readonly SemanticCalibrationRegistryEntry[]
  image_base64:string|null
}

function assessOne(
  observation:SemanticObservation,
  observationRef:string,
  runtime:SemanticRuntimeCalibrationContext,
  environment:SemanticCalibrationAssessmentEnvironment,
):SemanticCalibrationAssessmentItem{
  const resolution=resolveSemanticCalibrationArtifact(
    runtime,environment.artifacts,environment.datasets,environment.active_policy,environment.registry,
  )
  const artifact=resolution.artifact
  const calibrationStatus=
    resolution.status==='resolved'?'validated':
    resolution.status==='identity_mismatch'?'mismatch':
    resolution.status==='out_of_scope'?'out_of_scope':'unavailable'
  return {
    observation_ref:observationRef,feature_id:observation.feature_id,source:observation.source,
    independence_group:observation.independence_group,
    calibration_status:calibrationStatus,
    calibration_resolution_status:resolution.status,
    calibration_artifact_id:artifact?.calibration_id??null,
    raw_score:observation.raw_score,
    // Phase 2E confusion calibration models sensor behavior P(observation | semantic GT).
    // It does not invert this into P(GT | image), candidate probability, or candidate likelihood.
    calibrated_distribution:null,
    calibrated_probability:null,
    likelihood_eligible:resolution.status==='resolved',
    runtime_quality:runtime.quality,
    reason_codes:resolution.reason_codes,
  }
}

export function buildSemanticCalibrationAssessment(
  first:SemanticEvidenceV1|null,
  targeted:readonly TargetedSemanticEvidence[],
  environment:SemanticCalibrationAssessmentEnvironment,
):SemanticCalibrationAssessment{
  const items:SemanticCalibrationAssessmentItem[]=[]

  if(first){
    for(const observation of first.observations){
      const source=first.evidence_sources.find(s=>s.evidence_ref===observation.source)
      const cropRef=observation.evidence_refs[0]??first.observation_scope.target_region_ref
      const quality=buildSemanticRuntimeQuality(
        observation.visibility,
        semanticObservationQualityMetadata(observation.reason_codes,environment.image_base64,cropRef),
      )
      const runtime:SemanticRuntimeCalibrationContext={
        feature_id:observation.feature_id,
        sensor_type:(source?.sensor_type??'vlm') as SemanticSensorType,
        model:source?.model??'unknown',
        model_version:source?.model_version??'unknown',
        prompt_version:source?.prompt_version??'unknown',
        extractor_version:first.extractor_version,
        taxonomy_version:first.taxonomy_version,
        quality,
      }
      items.push(assessOne(
        observation,`first-pass:${observation.source}:${observation.feature_id}`,runtime,environment,
      ))
    }
  }

  for(const targetedEvidence of targeted){
    const observation=targetedEvidence.observation
    const cropRef=targetedEvidence.provenance.crop_ref
    const quality=buildSemanticRuntimeQuality(
      observation.visibility,
      semanticObservationQualityMetadata(observation.reason_codes,environment.image_base64,cropRef),
    )
    const runtime:SemanticRuntimeCalibrationContext={
      feature_id:observation.feature_id,
      sensor_type:targetedEvidence.provenance.sensor_type,
      model:targetedEvidence.provenance.model,
      model_version:targetedEvidence.provenance.model_version,
      prompt_version:targetedEvidence.provenance.prompt_version,
      extractor_version:'hcsi.targeted-semantic-extractor.v1',
      taxonomy_version:first?.taxonomy_version??'unknown',
      quality,
    }
    items.push(assessOne(observation,targetedEvidence.observation_id,runtime,environment))
  }

  return {
    schema_version:SEMANTIC_CALIBRATION_ASSESSMENT_SCHEMA,
    available:items.some(item=>item.likelihood_eligible),
    items,
  }
}
