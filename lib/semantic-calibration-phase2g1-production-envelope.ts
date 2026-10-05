import { sha256Canonical,isSha256 } from './semantic-calibration-digest'
import { semanticCalibrationImageWithinPolicyEnvelope,PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1,type SemanticCalibrationEligibilityPolicyV1 } from './semantic-calibration-policy-v1'
import { PHASE2G_SENSOR_IDENTITY } from './semantic-calibration-phase2g-observation'

export const PRODUCTION_CAPTURE_AUTHORITY_SCHEMA='hcsi.production-envelope-capture-authority.v1' as const
export interface ProductionCaptureAuthorityV1 {
 schema_version:typeof PRODUCTION_CAPTURE_AUTHORITY_SCHEMA
 authority_id:string
 authority_version:'1.0.0'
 specimen_id:string
 image_id:string
 feature_id:string
 split:'calibration'|'validation'
 acquired_at:string
 established_at:string
 acquisition_authority:{kind:'git_commit';ref:string}
 raw:{sha256:string;byte_length:number;width_px:number;height_px:number;format:string;source_ref:string}
 capture:{capture_type:string;crop_type:string;viewpoint:string;visibility:string;occlusion_condition:string;glare_condition:string}
 policy_binding:{policy_id:string;policy_version:string;policy_content_digest_sha256:string}
 content_digest_sha256:string
}
export type CaptureAuthorityDraft=Omit<ProductionCaptureAuthorityV1,'content_digest_sha256'>
export function captureAuthorityDigest(v:CaptureAuthorityDraft|ProductionCaptureAuthorityV1){
 const {content_digest_sha256:_d,...body}=v as ProductionCaptureAuthorityV1
 return sha256Canonical(body)
}
export function finalizeCaptureAuthority(v:CaptureAuthorityDraft):ProductionCaptureAuthorityV1{
 return {...v,content_digest_sha256:captureAuthorityDigest(v)}
}
export interface FrozenObservationBinding {
 observation_id:string; specimen_id:string; image_id:string; feature_id:string; split:'calibration'|'validation'
 observed_at:string; image_sha256:string; capture_authority_digest_sha256:string
 sensor_identity:typeof PHASE2G_SENSOR_IDENTITY
 original_observation:true
}
export interface ProductionEnvelopeAssessment {
 eligible_for_policy_envelope:boolean
 eligible_to_count_as_calibration_evidence:boolean
 reason_codes:string[]
 specimen_id:string
 image_id:string
 observation_id:string|null
 evaluated_policy_id:string
 evaluated_policy_version:string
 evaluated_policy_digest:string
 capture_authority_digest:string
}
const commitRef=/^git:\/\/commit\/[0-9a-f]{40}$/
export function assessProductionEnvelopeEvidence(
 authority:ProductionCaptureAuthorityV1,
 observation:FrozenObservationBinding|null,
 policy:SemanticCalibrationEligibilityPolicyV1=PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1,
):ProductionEnvelopeAssessment{
 const r:string[]=[]
 if(authority.schema_version!==PRODUCTION_CAPTURE_AUTHORITY_SCHEMA)r.push('capture_authority_schema_mismatch')
 if(authority.authority_version!=='1.0.0'||!authority.authority_id)r.push('capture_authority_identity_invalid')
 if(authority.content_digest_sha256!==captureAuthorityDigest(authority))r.push('capture_authority_digest_mismatch')
 if(!commitRef.test(authority.acquisition_authority.ref))r.push('pre_outcome_commit_authority_missing')
 if(!Number.isFinite(Date.parse(authority.acquired_at))||!Number.isFinite(Date.parse(authority.established_at))||Date.parse(authority.established_at)<Date.parse(authority.acquired_at))r.push('capture_authority_time_invalid')
 if(!authority.specimen_id||!authority.image_id)r.push('specimen_image_identity_missing')
 if(authority.feature_id!==policy.required_feature_id)r.push('feature_mismatch')
 if(authority.policy_binding.policy_id!==policy.policy_id||authority.policy_binding.policy_version!==policy.policy_version||authority.policy_binding.policy_content_digest_sha256!==policy.policy_content_digest_sha256)r.push('policy_lineage_mismatch')
 if(!isSha256(authority.raw.sha256)||!authority.raw.source_ref||!Number.isInteger(authority.raw.byte_length)||authority.raw.byte_length<=0)r.push('raw_provenance_invalid')
 const required:{key:keyof ProductionCaptureAuthorityV1['capture'];reason:string}[]=[
  {key:'capture_type',reason:'capture_type_missing'},{key:'crop_type',reason:'crop_type_missing'},{key:'viewpoint',reason:'viewpoint_missing'},
  {key:'visibility',reason:'visibility_missing'},{key:'occlusion_condition',reason:'occlusion_condition_missing'},{key:'glare_condition',reason:'glare_condition_missing'}]
 for(const x of required)if(!authority.capture[x.key])r.push(x.reason)
 const c=authority.capture
 const envImage={...c,width_px:authority.raw.width_px,height_px:authority.raw.height_px}
 if(!policy.capture_applicability.capture_types.includes(c.capture_type))r.push('capture_type_out_of_policy')
 if(!policy.capture_applicability.crop_types.includes(c.crop_type))r.push('crop_type_out_of_policy')
 if(!policy.capture_applicability.viewpoints.includes(c.viewpoint))r.push('viewpoint_out_of_policy')
 if(!policy.capture_applicability.visibility.includes(c.visibility))r.push('visibility_out_of_policy')
 if(!policy.capture_applicability.occlusion_conditions.includes(c.occlusion_condition))r.push('occlusion_out_of_policy')
 if(!policy.capture_applicability.glare_conditions.includes(c.glare_condition))r.push('glare_out_of_policy')
 if(authority.raw.width_px<policy.capture_applicability.resolution.min_width_px)r.push('width_below_policy_minimum')
 if(authority.raw.height_px<policy.capture_applicability.resolution.min_height_px)r.push('height_below_policy_minimum')
 if(!semanticCalibrationImageWithinPolicyEnvelope(envImage,policy))r.push('capture_outside_policy_envelope')
 const envelope=r.length===0
 if(!observation)r.push('immutable_observation_binding_missing')
 else{
  if(observation.specimen_id!==authority.specimen_id||observation.image_id!==authority.image_id||observation.feature_id!==authority.feature_id||observation.split!==authority.split)r.push('observation_authority_identity_mismatch')
  if(observation.image_sha256!==authority.raw.sha256)r.push('observation_raw_identity_mismatch')
  if(observation.capture_authority_digest_sha256!==authority.content_digest_sha256)r.push('observation_capture_authority_digest_mismatch')
  if(!Number.isFinite(Date.parse(observation.observed_at))||Date.parse(observation.observed_at)<Date.parse(authority.established_at))r.push('observation_precedes_capture_authority')
  if(JSON.stringify(observation.sensor_identity)!==JSON.stringify(PHASE2G_SENSOR_IDENTITY))r.push('sensor_identity_mismatch')
  if(observation.original_observation!==true)r.push('replacement_observation_forbidden')
 }
 return {eligible_for_policy_envelope:envelope,eligible_to_count_as_calibration_evidence:r.length===0,reason_codes:[...new Set(r)],specimen_id:authority.specimen_id,image_id:authority.image_id,observation_id:observation?.observation_id??null,evaluated_policy_id:policy.policy_id,evaluated_policy_version:policy.policy_version,evaluated_policy_digest:policy.policy_content_digest_sha256,capture_authority_digest:authority.content_digest_sha256}
}
export function uniqueEligibleSpecimenCount(items:Array<{authority:ProductionCaptureAuthorityV1;observation:FrozenObservationBinding|null}>,policy=PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1){
 const splitBySpecimen=new Map<string,string>(); const eligible=new Set<string>(); const reasons:string[]=[]
 for(const item of items){
  const prior=splitBySpecimen.get(item.authority.specimen_id)
  if(prior&&prior!==item.authority.split){reasons.push('physical_specimen_crosses_splits');continue}
  splitBySpecimen.set(item.authority.specimen_id,item.authority.split)
  if(assessProductionEnvelopeEvidence(item.authority,item.observation,policy).eligible_to_count_as_calibration_evidence)eligible.add(item.authority.specimen_id)
 }
 return {unique_physical_specimen_count:eligible.size,reason_codes:[...new Set(reasons)]}
}
