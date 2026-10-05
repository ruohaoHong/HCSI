import assert from 'node:assert/strict'
import type { MeasurementV2,NominalCandidate } from './measurement-v2'
import type { StandardsAuthorityResult } from './standards-shadow-solver'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { CANDIDATE_FEATURE_METADATA_SCHEMA,type CandidateFeatureMetadataSnapshot } from './candidate-feature-metadata-v1'
import type { SemanticEvidenceV1,SemanticObservation } from './semantic-evidence-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { SEMANTIC_REASON_CODE_TAXONOMY_VERSION } from './semantic-reason-codes-v1'
import { orchestratePurchaseDecision,renderOrchestrationDecision } from './inference-orchestrator'

const rec=STANDARDS_CATALOGUE_V1.records.find(x=>x.designation==='M14×2.0')!
const candidate=(id:string,designation:string,d=14,p=2):NominalCandidate=>({candidate_id:id,standard_system:'iso_metric',family:'metric_coarse',designation,nominal:{diameter_mm:d,pitch_mm:p,tpi:null,length_mm:null,length_convention:'head_underface_to_tip'},standard_ref:{catalogue_id:STANDARDS_CATALOGUE_V1.catalogue_id,catalogue_version:STANDARDS_CATALOGUE_V1.catalogue_version,snapshot_id:STANDARDS_CATALOGUE_V1.snapshot.snapshot_id,record_id:rec.record_id,provenance:'phase2i_fixture'},residuals:{},score:{measurement_log_likelihood:null,rank:null}})
const measurement=(sha='a'.repeat(64)):MeasurementV2=>({schema_version:'hcsi.measurement.v2',source_schema_version:'hcsi.measurement.v1',image_sha256:sha,observations:[],head_geometry:null,scale:{system:'metric',px_per_cm:null,px_per_inch:null,source:'unknown',confidence:0},capture_assumptions:{},uncertainty:{covariance:{status:'not_estimated'}} as any,immutability:{raw_measurements_are_nominally_snapped:false,nominal_solver_may_modify_measurement:false}} as unknown as MeasurementV2)
const authority=(m:MeasurementV2,cs:NominalCandidate[]):StandardsAuthorityResult=>({mode:'standards_authority',contract_version:'hcsi.standards-authority.v1',measurement_v2:m,standards_snapshot:{snapshot_id:STANDARDS_CATALOGUE_V1.snapshot.snapshot_id,snapshot_version:STANDARDS_CATALOGUE_V1.snapshot.snapshot_version,coverage_status:STANDARDS_CATALOGUE_V1.snapshot.coverage_status},formal_candidates:cs,decision:{selected_candidate_id:null,status:cs.length?'unresolved':'no_normative_match',purchase_ready:false,reason:'deterministic_selection_not_implemented'},legacy_diagnostics:{llm_nominal:{value:null,authority:'non_authoritative',use:'diagnostic_only'},dimension_candidate:{value:null,authority:'non_authoritative',use:'diagnostic_only'}},candidate_summary:{total:cs.length,iso_metric:cs.length,unified_inch:0,nearest_by_provisional_residual_candidate_id:null},scoring_state:{model_id:'phase1-euclidean-dp-residual-v1',calibrated_probability_available:false,covariance_available:false,tolerance_likelihood_available:false,todo:'fixture'}})
const metadata=(cs:NominalCandidate[],feature:'drive.form'|'head.profile',values:string[]):CandidateFeatureMetadataSnapshot=>({schema_version:CANDIDATE_FEATURE_METADATA_SCHEMA,metadata_id:'phase2i-fixture',metadata_version:'1',snapshot_id:'phase2i-meta',standards_snapshot_id:STANDARDS_CATALOGUE_V1.snapshot.snapshot_id,authority_scope:'normative_product_semantic_constraints',explicitly_excluded:['market_commonness','supplier_frequency','commercial_availability','metric_inch_prior','thread_designation_to_product_morphology_inference'],records:cs.map((c,i)=>({constraint_id:`r${i}`,candidate_record_id:c.standard_ref.record_id,feature_id:feature,relation:'requires',expected_value:values[i],provenance:{source_type:'normative_product_metadata',snapshot_id:'phase2i-meta',record_id:`r${i}`,field:feature,source_ids:['fixture'],derivation_rule_id:null,derivation_rule_version:null}}))})
// Give each fixture candidate a distinct normative record identity while retaining the frozen standards snapshot.
const withRecord=(c:NominalCandidate,i:number)=>({...c,standard_ref:{...c.standard_ref,record_id:c.standard_ref.record_id+'-'+i}})
const obs=(feature:'drive.form'|'head.profile',value:string,state:'observed'|'not_visible'='observed'):SemanticObservation=>({feature_id:feature,feature_family:feature==='drive.form'?'drive_form':'head_profile',value,state,visibility:state==='not_visible'?'not_visible':'visible',raw_score:null,calibrated_probability:null,calibration_status:'uncalibrated',source:'fixture_sensor',evidence_refs:['img'],independence_group:'img',reason_codes:state==='not_visible'?['FEATURE_NOT_VISIBLE']:['FEATURE_VISIBLE'],freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null})
const evidence=(o:SemanticObservation,rawText:string|null=null):SemanticEvidenceV1=>({schema_version:'hcsi.semantic-evidence.v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,extractor_version:'hcsi.candidate-blind-vlm.v1',observation_scope:{mode:'candidate_blind_first_pass',image_sha256:'a'.repeat(64),target_region_ref:'img',physical_measurements_included:false,standards_candidates_included:false,legacy_nominal_included:false,ground_truth_included:false},observations:[{...o,raw_text:rawText}],unknown_or_open_set:[],evidence_sources:[],independence_groups:[],quality:{status:'usable',reason_codes:['TARGET_CLEAR']}})

async function main(){
 const m=measurement(),single=[withRecord(candidate('A','M14×2.0'),0)];let calls=0
 // I1 physical/formal uniqueness answers without semantic escalation.
 let r=await orchestratePurchaseDecision({inference_id:'I1',image_ref:'img1',measurement:m,standards_authority:authority(m,single),feature_metadata:metadata(single,'drive.form',['hex_socket']),semantic_escalator:async()=>{calls++;throw new Error('must_not_call')}})
 assert.equal(r.decision,'purchase_ready');assert.equal(r.selected_candidate_id,'A');assert.equal(r.semantic_invocation_count,0);assert.equal(calls,0);assert.equal(r.purchase_spec?.designation,'M14×2.0')
 // I2 A/B ambiguity asks candidate-blind current-image drive evidence once; actual evidence selects A.
 const ab=[withRecord(candidate('A','M14×2.0'),0),withRecord(candidate('B','M14×2.0 external-hex'),1)],meta=metadata(ab,'drive.form',['hex_socket','external_hex']);calls=0
 r=await orchestratePurchaseDecision({inference_id:'I2',image_ref:'img2',measurement:m,standards_authority:authority(m,ab),feature_metadata:meta,semantic_escalator:async req=>{calls++;assert.equal(req.candidate_blind,true);assert.equal(req.formal_candidates_in_sensor_input,false);assert.equal((req as any).candidate_ids,undefined);return evidence(obs('drive.form','hex_socket'))}})
 assert.equal(r.decision,'purchase_ready');assert.equal(r.selected_candidate_id,'A');assert.equal(calls,1);assert.equal(r.numeric_confidence,null);assert.equal(r.posterior_probability,null)
 // I3 completed not_visible is never retried on the same image; exact drive-face follow-up survives.
 calls=0;r=await orchestratePurchaseDecision({inference_id:'I3',image_ref:'img3',measurement:m,standards_authority:authority(m,ab),feature_metadata:meta,semantic_evidence:evidence(obs('drive.form','not_visible','not_visible')),semantic_escalator:async()=>{calls++;throw new Error('same_image_retry')}})
 assert.equal(r.decision,'targeted_followup_required');assert.equal(r.requested_evidence?.acquisition,'drive_face_view');assert.equal(calls,0);assert.equal(r.purchase_spec,null)
 // I4 genuinely new image/evidence continues lineage; old not-visible evidence ref remains.
 r=await orchestratePurchaseDecision({inference_id:'I3',image_ref:'img3-followup',measurement:m,standards_authority:authority(m,ab),feature_metadata:meta,semantic_evidence:evidence(obs('drive.form','hex_socket')),evidence_history_refs:['semantic:img3:drive.form','semantic:img3-followup:drive.form']})
 assert.equal(r.decision,'purchase_ready');assert.equal(r.selected_candidate_id,'A');assert.deepEqual(r.evidence_history_refs,['semantic:img3:drive.form','semantic:img3-followup:drive.form'])
 // I5 one observation contradicts every formal candidate: no purchase surface.
 r=await orchestratePurchaseDecision({inference_id:'I5',image_ref:'img5',measurement:m,standards_authority:authority(m,ab),feature_metadata:meta,semantic_evidence:evidence(obs('drive.form','slotted'))})
 assert.equal(r.decision,'contradictory_evidence');assert.equal(r.purchase_spec,null)
 // I6 material candidates with no supported physical/semantic discriminator remain unresolved.
 const u=[withRecord(candidate('U1','designation-one'),0),withRecord(candidate('U2','designation-two'),1)],empty=metadata(u,'drive.form',['hex_socket','hex_socket']);empty.records=[]
 r=await orchestratePurchaseDecision({inference_id:'I6',image_ref:'img6',measurement:m,standards_authority:authority(m,u),feature_metadata:empty});assert.equal(r.decision,'unresolved');assert.equal(r.purchase_spec,null)
 // I7 renderer cannot manufacture a winner from a non-purchase decision.
 assert.equal(renderOrchestrationDecision(r).purchase_winner,null)
 // I8 semantic free text naming an outside standard has zero candidate authority.
 const before=ab.map(x=>x.candidate_id);r=await orchestratePurchaseDecision({inference_id:'I8',image_ref:'img8',measurement:m,standards_authority:authority(m,ab),feature_metadata:meta,semantic_evidence:evidence(obs('drive.form','not_visible','not_visible'),'M99×9.9')});assert.deepEqual(r.formal_candidate_ids,before);assert.equal(r.formal_candidate_ids.includes('M99×9.9'),false)
 // Provider failure is infrastructure state, never semantic unknown and never a purchase winner.
 r=await orchestratePurchaseDecision({inference_id:'IF',image_ref:'imgf',measurement:m,standards_authority:authority(m,ab),feature_metadata:meta,semantic_escalator:async()=>{throw new Error('timeout')}});assert.equal(r.orchestration_error?.code,'semantic_provider_failure');assert.equal(r.purchase_spec,null);assert.equal(r.semantic_invocation_count,0)
 // Permanent Case C: raw values remain exact, M14/9/16 survive, no commonness winner, deterministic next physical discriminator.
 const cm=measurement('c'.repeat(64));cm.observations=[['D',13.700],['P',2.051],['L_underhead',47.540],['K',9.450],['DK',25.864]].map(([quantity,value_mm])=>({quantity,value_mm,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]})) as any
 const c1=withRecord(candidate('M14','M14×2.0',14,2),0),c2=withRecord({...candidate('UNC','9/16-12 UNC',14.2875,25.4/12),standard_system:'unified_inch',family:'unc'},1)
 const cmeta=metadata([c1,c2],'drive.form',['hex_socket','hex_socket']);cmeta.records=[]
 r=await orchestratePurchaseDecision({inference_id:'CASE-C',image_ref:'case-c',measurement:cm,standards_authority:authority(cm,[c1,c2]),feature_metadata:cmeta})
 assert.equal(r.selected_candidate_id,null);assert.equal(r.decision,'targeted_followup_required');assert.equal(r.requested_evidence?.acquisition,'diameter_measurement');assert.equal((r.measurement.observations.find(x=>x.quantity==='L_underhead')!).value_mm,47.540);assert.deepEqual(r.formal_candidate_ids,['M14','UNC'])
 console.log('Phase 2I orchestration regressions I1-I8 + provider failure + Case C passed')
}
main()
