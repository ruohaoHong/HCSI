import { strict as assert } from 'node:assert'
import type { MeasurementV2,NominalCandidate } from './measurement-v2'
import { MEASUREMENT_V2_SCHEMA } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'
import { compileCandidateFeatureMatrix } from './candidate-feature-compiler'
import { CANDIDATE_FEATURE_METADATA_SCHEMA,type CandidateFeatureMetadataSnapshot } from './candidate-feature-metadata-v1'
import { buildCandidateSemanticDiscrimination } from './candidate-semantic-discrimination'
import type { SemanticEvidenceV1,SemanticObservation } from './semantic-evidence-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { SEMANTIC_REASON_CODE_TAXONOMY_VERSION } from './semantic-reason-codes-v1'
import { convergeEvidence,renderTaiwanFollowup } from './evidence-convergence'
const measurement={schema_version:MEASUREMENT_V2_SCHEMA,observations:[{quantity:'D',value_mm:13.700},{quantity:'P',value_mm:2.051},{quantity:'L_underhead',value_mm:47.540}],uncertainty:{schema_version:'hcsi.measurement-uncertainty.v1',quantities:[],primitives:[],covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'2h'},systematic_bias_ledger:[],systematic_bias_status:'not_estimated'}} as unknown as MeasurementV2
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1),m14=authority.formal_candidates.find(c=>c.designation==='M14 × 2.0')!,u916=authority.formal_candidates.find(c=>c.designation==='9/16-12 UNC')!;assert.ok(m14&&u916)
const clone=(c:NominalCandidate,id:string,patch:Partial<NominalCandidate['nominal']>={})=>({...c,candidate_id:id,nominal:{...c.nominal,...patch},standard_ref:{...c.standard_ref,record_id:id}})
function metadata(cs:NominalCandidate[],feature:'drive.form'|'head.profile',values:string[]):CandidateFeatureMetadataSnapshot{return{schema_version:CANDIDATE_FEATURE_METADATA_SCHEMA,metadata_id:'2h-test',metadata_version:'1',snapshot_id:'2h-test',standards_snapshot_id:authority.standards_snapshot.snapshot_id,authority_scope:'normative_product_semantic_constraints',explicitly_excluded:['market_commonness','supplier_frequency','commercial_availability','metric_inch_prior','thread_designation_to_product_morphology_inference'],records:cs.map((c,i)=>({constraint_id:'x'+i,candidate_record_id:c.standard_ref.record_id,feature_id:feature,relation:'requires',expected_value:values[i],provenance:{source_type:'normative_product_metadata',snapshot_id:'2h-test',record_id:c.standard_ref.record_id,field:feature,source_ids:['normative-test'],derivation_rule_id:null,derivation_rule_version:null}}))}}
function obs(feature:'drive.form'|'head.profile',value:string,state:SemanticObservation['state']='observed',visibility:SemanticObservation['visibility']='visible'):SemanticObservation{return{feature_id:feature,feature_family:feature==='drive.form'?'drive_form':'head_profile',value,state,visibility,raw_score:null,calibrated_probability:null,calibration_status:'uncalibrated',source:'candidate-blind-test',evidence_refs:['img'],independence_group:'img',reason_codes:[],freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null}}
function evidence(o:SemanticObservation):SemanticEvidenceV1{return{schema_version:'hcsi.semantic-evidence.v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,extractor_version:'hcsi.candidate-blind-vlm.v1',observation_scope:{mode:'candidate_blind_first_pass',image_sha256:'a'.repeat(64),target_region_ref:'full',physical_measurements_included:false,standards_candidates_included:false,legacy_nominal_included:false,ground_truth_included:false},observations:[o],unknown_or_open_set:[],evidence_sources:[],independence_groups:[],quality:{status:'usable',reason_codes:[]}}}
// H1 geometry/formal universe already unique; semantic evidence is unnecessary.
let r=convergeEvidence({formal_candidates:[m14]});assert.equal(r.decision,'purchase_ready');assert.equal(r.numeric_confidence,null)
// H2 uncalibrated candidate-blind morphology deterministically eliminates only the incompatible formal candidate.
const a=clone(m14,'A'),b=clone(m14,'B'),dm=metadata([a,b],'drive.form',['external_hex','hex_socket']),matrix=compileCandidateFeatureMatrix([a,b],dm)
let disc=buildCandidateSemanticDiscrimination(matrix,evidence(obs('drive.form','external_hex')),[])
r=convergeEvidence({formal_candidates:[a,b],feature_matrix:matrix,semantic_discrimination:disc,evidence_history_refs:['first-pass']});assert.equal(r.decision,'purchase_ready');assert.equal(r.selected_candidate_id,'A');assert.equal(r.decision_strength,'multi_source_convergence');assert.deepEqual(r.evidence_history_refs,['first-pass'])
// H3 not_visible is absence of evidence, not contradiction; a unique formal purchase result remains answerable.
r=convergeEvidence({formal_candidates:[m14]});assert.equal(r.decision,'purchase_ready')
// H4 material drive ambiguity produces a specific drive-face request.
disc=buildCandidateSemanticDiscrimination(matrix,evidence(obs('drive.form','not_visible','not_visible','not_visible')),[])
r=convergeEvidence({formal_candidates:[a,b],feature_matrix:matrix,semantic_discrimination:disc});assert.equal(r.decision,'targeted_followup_required');assert.equal(r.requested_evidence?.acquisition,'drive_face_view');assert.ok(renderTaiwanFollowup(r).includes('螺絲頭正面'))
// H5 pitch-only difference requests pitch evidence.
const p1=clone(m14,'P1',{pitch_mm:1.5}),p2=clone(m14,'P2',{pitch_mm:2.0});r=convergeEvidence({formal_candidates:[p1,p2]});assert.equal(r.requested_evidence?.acquisition,'thread_pitch_measurement')
// H6 normative head-profile difference requests head profile.
const h1=clone(m14,'H1'),h2=clone(m14,'H2'),hm=compileCandidateFeatureMatrix([h1,h2],metadata([h1,h2],'head.profile',['pan','socket_cap']));r=convergeEvidence({formal_candidates:[h1,h2],feature_matrix:hm});assert.equal(r.requested_evidence?.acquisition,'head_profile_view')
// H7 unique formal geometry contradicted by deterministic normative morphology => contradiction, never overwrite geometry.
const oneM=compileCandidateFeatureMatrix([a],metadata([a],'drive.form',['external_hex'])),oneD=buildCandidateSemanticDiscrimination(oneM,evidence(obs('drive.form','hex_socket')),[]);r=convergeEvidence({formal_candidates:[a],feature_matrix:oneM,semantic_discrimination:oneD});assert.equal(r.decision,'contradictory_evidence');assert.equal(r.selected_candidate_id,null)
// H8 morphology contradicts every formal candidate; no new standard is created.
const allD=buildCandidateSemanticDiscrimination(matrix,evidence(obs('drive.form','slotted')),[]);r=convergeEvidence({formal_candidates:[a,b],feature_matrix:matrix,semantic_discrimination:allD});assert.equal(r.decision,'contradictory_evidence');assert.deepEqual(r.candidate_ids_entered,['A','B']);assert.equal(r.candidate_ids_surviving.length,0)
// Confirmation is only for materially equivalent formal purchase specs.
const eq1=clone(m14,'EQ1'),eq2=clone(m14,'EQ2');r=convergeEvidence({formal_candidates:[eq1,eq2]});assert.equal(r.decision,'purchase_ready_with_confirmation')
// Follow-up loop is append-only by input refs: new evidence reruns the same engine and converges without erasing history.
r=convergeEvidence({formal_candidates:[a,b],feature_matrix:matrix,semantic_discrimination:buildCandidateSemanticDiscrimination(matrix,evidence(obs('drive.form','hex_socket')),[]),evidence_history_refs:['view-1:not-visible','view-2:visible']});assert.equal(r.decision,'purchase_ready');assert.deepEqual(r.evidence_history_refs,['view-1:not-visible','view-2:visible'])
// Case C: preserve raw facts, retain both formal candidates, never commonness-select; return a concrete supported discriminator.
assert.equal((measurement.observations.find(x=>x.quantity==='D') as any).value_mm,13.700);assert.equal((measurement.observations.find(x=>x.quantity==='P') as any).value_mm,2.051);assert.equal((measurement.observations.find(x=>x.quantity==='L_underhead') as any).value_mm,47.540);assert.equal(authority.formal_candidates.some(c=>/#37-12/i.test(c.designation)),false)
r=convergeEvidence({formal_candidates:[m14,u916]});assert.equal(r.decision,'targeted_followup_required');assert.ok(['diameter_measurement','thread_pitch_measurement'].includes(r.requested_evidence!.acquisition));assert.equal(r.selected_candidate_id,null)
console.log('Phase 2H deterministic convergence regressions H1-H8 + confirmation/follow-up/Case C passed')
console.log(JSON.stringify({H1:'purchase_ready',H2:'purchase_ready via uncalibrated deterministic morphology',H3:'purchase_ready despite irrelevant missing drive',H4:'targeted drive_face_view',H5:'targeted thread_pitch_measurement',H6:'targeted head_profile_view',H7:'contradictory_evidence',H8:'contradictory_evidence/no candidate creation',case_c:r.requested_evidence?.acquisition,numeric_confidence:null,posterior_probability:null},null,2))
