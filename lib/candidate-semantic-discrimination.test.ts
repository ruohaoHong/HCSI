import type { MeasurementV2, NominalCandidate } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'
import {
  CANDIDATE_FEATURE_METADATA_SCHEMA,
  CANDIDATE_FEATURE_METADATA_V1,
  type CandidateFeatureMetadataSnapshot,
} from './candidate-feature-metadata-v1'
import { compileCandidateFeatureMatrix } from './candidate-feature-compiler'
import { buildSemanticDiscriminationPlan } from './semantic-discrimination-plan-v1'
import { buildTargetedSemanticRequest, assertTargetedRequestCandidateBlind } from './targeted-semantic-request'
import { buildCandidateBlindSemanticRequest } from './candidate-blind-semantic-request'
import { buildTargetedSemanticEvidence, targetedSemanticSensorJsonSchema } from './targeted-semantic-extractor'
import { buildCandidateSemanticDiscrimination, evaluateSemanticCompatibility } from './candidate-semantic-discrimination'
import type { SemanticEvidenceV1, SemanticObservation, RawSemanticSensorObservation } from './semantic-evidence-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { SEMANTIC_REASON_CODE_TAXONOMY_VERSION } from './semantic-reason-codes-v1'

function ok(v:unknown,m='assertion failed'):asserts v {if(!v)throw new Error(m)}
function eq(a:unknown,b:unknown,m='values differ'){if(a!==b)throw new Error(`${m}: ${String(a)} !== ${String(b)}`)}

const measurement={
 schema_version:MEASUREMENT_V2_SCHEMA,
 observations:[
  {quantity:'D',value_mm:13.700},{quantity:'P',value_mm:2.051},{quantity:'L_underhead',value_mm:47.540},
 ],
 uncertainty:{schema_version:'hcsi.measurement-uncertainty.v1',quantities:[],primitives:[],
  covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'phase2c fixture'},
  systematic_bias_ledger:[],systematic_bias_status:'not_estimated'},
} as unknown as MeasurementV2
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1)
const m14=authority.formal_candidates.find(c=>c.designation==='M14 × 2.0')!
const u916=authority.formal_candidates.find(c=>c.designation==='9/16-12 UNC')!
ok(m14&&u916)

// Test A — real thread candidates do not invent morphology.
const realMatrix=compileCandidateFeatureMatrix([m14,u916],CANDIDATE_FEATURE_METADATA_V1)
eq(realMatrix.discriminative_features.length,0)
for(const profile of realMatrix.profiles) for(const constraint of profile.feature_constraints){
 eq(constraint.relation,'not_specified')
 eq(constraint.support_status,'unavailable')
 eq(constraint.expected_value,null)
}
const realPlan=buildSemanticDiscriminationPlan(realMatrix,null)
eq(realPlan.status,'no_semantic_discriminator_available')
eq(realPlan.discriminators.length,0)

function syntheticCandidates():[NominalCandidate,NominalCandidate]{
 return [
  {...m14,candidate_id:'synthetic:A',standard_ref:{...m14.standard_ref,record_id:'synthetic-A'}},
  {...u916,candidate_id:'synthetic:B',standard_ref:{...u916.standard_ref,record_id:'synthetic-B'}},
 ]
}
function metadata(records:CandidateFeatureMetadataSnapshot['records']):CandidateFeatureMetadataSnapshot{
 return {
  schema_version:CANDIDATE_FEATURE_METADATA_SCHEMA,metadata_id:'synthetic-product-metadata',
  metadata_version:'test-v1',snapshot_id:'synthetic-product-snapshot-v1',
  standards_snapshot_id:authority.standards_snapshot.snapshot_id,
  authority_scope:'normative_product_semantic_constraints',
  explicitly_excluded:['market_commonness','supplier_frequency','commercial_availability','metric_inch_prior','thread_designation_to_product_morphology_inference'],
  records,
 }
}
function record(candidate_record_id:string,relation:'requires'|'allows'|'forbids',expected_value:string,id:string){
 return {constraint_id:id,candidate_record_id,feature_id:'drive.form' as const,relation,expected_value,
  provenance:{source_type:'normative_product_metadata' as const,snapshot_id:'synthetic-product-snapshot-v1',
   record_id:candidate_record_id,field:'drive.form',source_ids:['synthetic-normative-source'],
   derivation_rule_id:null,derivation_rule_version:null}}
}
const [a,b]=syntheticCandidates()

// Test B — valid synthetic discriminator.
const diffMetadata=metadata([
 record('synthetic-A','requires','external_hex','constraint-A-drive'),
 record('synthetic-B','requires','hex_socket','constraint-B-drive'),
])
const diffMatrix=compileCandidateFeatureMatrix([a,b],diffMetadata)
ok(diffMatrix.discriminative_features.includes('drive.form'))
const diffPlan=buildSemanticDiscriminationPlan(diffMatrix,null)
eq(diffPlan.status,'discriminators_available')
eq(diffPlan.discriminators.length,1)
eq(diffPlan.discriminators[0].feature_id,'drive.form')

// Test C — identical candidate features do not discriminate.
const sameMatrix=compileCandidateFeatureMatrix([a,b],metadata([
 record('synthetic-A','allows','external_hex','same-A'),
 record('synthetic-B','allows','external_hex','same-B'),
]))
eq(sameMatrix.discriminative_features.includes('drive.form'),false)

// Test D — not_specified is not forbid.
const partialMatrix=compileCandidateFeatureMatrix([a,b],metadata([
 record('synthetic-B','requires','hex_socket','only-B'),
]))
const aDrive=partialMatrix.profiles[0].feature_constraints.find(x=>x.feature_id==='drive.form')!
eq(aDrive.relation,'not_specified')
eq(aDrive.support_status,'unavailable')

function observation(value:string,state:SemanticObservation['state']='observed',visibility:SemanticObservation['visibility']='visible'):SemanticObservation{
 return {feature_id:'drive.form',feature_family:'drive_form',value,state,visibility,raw_score:null,
  calibrated_probability:null,calibration_status:'uncalibrated',source:'first-pass-source',
  evidence_refs:['full_image_1'],independence_group:'full_image_1',reason_codes:[],
  freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null}
}
const aConstraint=diffMatrix.profiles[0].feature_constraints.find(x=>x.feature_id==='drive.form')!
const bConstraint=diffMatrix.profiles[1].feature_constraints.find(x=>x.feature_id==='drive.form')!

// Positive synthetic compatibility.
eq(evaluateSemanticCompatibility(aConstraint,observation('external_hex')).compatibility_state,'supports')
eq(evaluateSemanticCompatibility(bConstraint,observation('external_hex')).compatibility_state,'contradicts')
eq(evaluateSemanticCompatibility(aDrive,observation('hex_socket')).compatibility_state,'candidate_feature_unspecified')

// Test E — not_visible cannot contradict.
eq(evaluateSemanticCompatibility(aConstraint,observation('not_visible','not_visible','not_visible')).compatibility_state,'not_visible')
eq(evaluateSemanticCompatibility(bConstraint,observation('not_visible','not_visible','not_visible')).compatibility_state,'not_visible')

// Test F — ambiguous cannot hard contradict.
eq(evaluateSemanticCompatibility(bConstraint,observation('unknown','ambiguous','visible')).compatibility_state,'unknown')

// Test G — open_set cannot nearest-match.
eq(evaluateSemanticCompatibility(bConstraint,observation('open_set','open_set','visible')).compatibility_state,'unknown')

// First-pass fixture used by H/J.
const firstPass={
 schema_version:'hcsi.semantic-evidence.v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
 reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,
 extractor_version:'hcsi.candidate-blind-vlm.v1',
 observation_scope:{mode:'candidate_blind_first_pass',image_sha256:'a'.repeat(64),target_region_ref:'full_image_1',
  physical_measurements_included:false,standards_candidates_included:false,legacy_nominal_included:false,ground_truth_included:false},
 observations:[observation('external_hex')],unknown_or_open_set:[],evidence_sources:[],
 independence_groups:[{group_id:'full_image_1',crop_ref:'full_image_1',image_sha256:'a'.repeat(64),description:'same crop'}],
 quality:{status:'usable',reason_codes:[]},
} as SemanticEvidenceV1

// Test H — sufficient first-pass evidence is reused; no targeted request is needed.
const reusePlan=buildSemanticDiscriminationPlan(diffMatrix,firstPass)
eq(reusePlan.discriminators[0].status,'reuse_first_pass')
ok(reusePlan.discriminators[0].reused_observation_ref)

// Test I — targeted request runtime allowlist is candidate blind.
const baseRequest=buildCandidateBlindSemanticRequest({image:Buffer.from('phase2c').toString('base64')})
const targetedRequest=buildTargetedSemanticRequest(baseRequest,'drive.form')
assertTargetedRequestCandidateBlind(targetedRequest)
const serialized=JSON.stringify(targetedRequest)
for(const forbidden of ['synthetic:A','synthetic:B','M14','9/16','UNC','iso_metric','unified_inch','metric','inch','candidate_id','designation','standard_system','rank','residual','physical_likelihood','legacy_nominal','ground_truth']){
 eq(serialized.includes(forbidden),false,`targeted request leaked ${forbidden}`)
}
ok(targetedSemanticSensorJsonSchema(targetedRequest))

// Test J — same crop targeted refinement shares independence group and keeps history linkage.
const rawTargeted:RawSemanticSensorObservation={
 feature_id:'drive.form',value:'external_hex',state:'observed',visibility:'visible',raw_score:null,
 calibrated_probability:null,calibration_status:'uncalibrated',reason_codes:['FEATURE_VISIBLE'],
 freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null,
}
const targetedEvidence=buildTargetedSemanticEvidence(rawTargeted,targetedRequest,firstPass,{model:'mock-vlm',model_version:'mock-v1'})
eq(targetedEvidence.observation.independence_group,'full_image_1')
ok(targetedEvidence.refines_observation_id)
eq(targetedEvidence.supersedes_for_latest_view,true)
eq(targetedEvidence.observation.calibration_status,'uncalibrated')
eq(targetedEvidence.observation.calibrated_probability,null)

// Test K — candidate universe is unchanged by discrimination.
const discrimination=buildCandidateSemanticDiscrimination(diffMatrix,firstPass,[])
eq(JSON.stringify(discrimination.candidate_ids_before),JSON.stringify(['synthetic:A','synthetic:B']))
eq(JSON.stringify(discrimination.candidate_ids_after),JSON.stringify(discrimination.candidate_ids_before))

// Test L — no decision side effect, score, probability or purchase readiness.
eq(discrimination.decision.selected_candidate_id,null)
eq(discrimination.decision.purchase_ready,false)
eq(discrimination.numeric_score,null)
eq(discrimination.posterior_probability,null)
eq(discrimination.candidates[0].feature_evaluations[0].compatibility_state,'supports')
eq(discrimination.candidates[1].feature_evaluations[0].compatibility_state,'contradicts')

// Case C raw physical evidence remains immutable throughout Phase 2C.
eq((measurement.observations.find(x=>x.quantity==='D') as any).value_mm,13.700)
eq((measurement.observations.find(x=>x.quantity==='P') as any).value_mm,2.051)
eq((measurement.observations.find(x=>x.quantity==='L_underhead') as any).value_mm,47.540)
ok(authority.formal_candidates.some(c=>c.designation==='M14 × 2.0'))
ok(authority.formal_candidates.some(c=>c.designation==='9/16-12 UNC'))
eq(authority.formal_candidates.some(c=>/#37-12/i.test(c.designation)),false)
eq(authority.decision.selected_candidate_id,null)
eq(authority.decision.purchase_ready,false)

console.log('Phase 2C candidate compiler/discriminator regressions A-L passed')
