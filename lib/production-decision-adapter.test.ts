import assert from 'node:assert/strict'
import type { MeasurementV2,NominalCandidate } from './measurement-v2'
import type { StandardsAuthorityResult } from './standards-shadow-solver'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { CANDIDATE_FEATURE_METADATA_SCHEMA,type CandidateFeatureMetadataSnapshot } from './candidate-feature-metadata-v1'
import type { SemanticEvidenceV1,SemanticObservation } from './semantic-evidence-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { SEMANTIC_REASON_CODE_TAXONOMY_VERSION } from './semantic-reason-codes-v1'
import { orchestratePurchaseDecision } from './inference-orchestrator'
import { buildCanonicalPublicDecision } from './production-decision-adapter'
const rec=STANDARDS_CATALOGUE_V1.records.find(x=>x.designation==='M14 × 2.0')!
const candidate=(id:string,designation:string,d=14,p=2):NominalCandidate=>({candidate_id:id,standard_system:'iso_metric',family:'metric_coarse',designation,nominal:{diameter_mm:d,pitch_mm:p,tpi:null,length_mm:null,length_convention:'head_underface_to_tip'},standard_ref:{catalogue_id:STANDARDS_CATALOGUE_V1.catalogue_id,catalogue_version:STANDARDS_CATALOGUE_V1.catalogue_version,snapshot_id:STANDARDS_CATALOGUE_V1.snapshot.snapshot_id,record_id:rec.record_id,provenance:'2j-fixture'},residuals:{},score:{measurement_log_likelihood:null,rank:null}})
const wr=(c:NominalCandidate,i:number)=>({...c,standard_ref:{...c.standard_ref,record_id:c.standard_ref.record_id+'-'+i}})
const measurement=(sha='a'.repeat(64))=>({schema_version:'hcsi.measurement.v2',image_sha256:sha,observations:[],uncertainty:{covariance:{status:'not_estimated'}}} as unknown as MeasurementV2)
const authority=(m:MeasurementV2,cs:NominalCandidate[]):StandardsAuthorityResult=>({mode:'standards_authority',contract_version:'hcsi.standards-authority.v1',measurement_v2:m,standards_snapshot:{snapshot_id:STANDARDS_CATALOGUE_V1.snapshot.snapshot_id,snapshot_version:STANDARDS_CATALOGUE_V1.snapshot.snapshot_version,coverage_status:STANDARDS_CATALOGUE_V1.snapshot.coverage_status},formal_candidates:cs,decision:{selected_candidate_id:null,status:cs.length?'unresolved':'no_normative_match',purchase_ready:false,reason:'deterministic_selection_not_implemented'},legacy_diagnostics:{llm_nominal:{value:'#37-12',authority:'non_authoritative',use:'diagnostic_only'},dimension_candidate:{value:'legacy',authority:'non_authoritative',use:'diagnostic_only'}},candidate_summary:{total:cs.length,iso_metric:cs.length,unified_inch:0,nearest_by_provisional_residual_candidate_id:cs[0]?.candidate_id??null},scoring_state:{model_id:'phase1-euclidean-dp-residual-v1',calibrated_probability_available:false,covariance_available:false,tolerance_likelihood_available:false,todo:'fixture'}})
const metadata=(cs:NominalCandidate,feature:'drive.form',value:string):any=>metadataMany([cs],feature,[value])
const metadataMany=(cs:NominalCandidate[],feature:'drive.form',values:string[]):CandidateFeatureMetadataSnapshot=>({schema_version:CANDIDATE_FEATURE_METADATA_SCHEMA,metadata_id:'2j',metadata_version:'1',snapshot_id:'2j-meta',standards_snapshot_id:STANDARDS_CATALOGUE_V1.snapshot.snapshot_id,authority_scope:'normative_product_semantic_constraints',explicitly_excluded:['market_commonness','supplier_frequency','commercial_availability','metric_inch_prior','thread_designation_to_product_morphology_inference'],records:cs.map((c,i)=>({constraint_id:'j'+i,candidate_record_id:c.standard_ref.record_id,feature_id:feature,relation:'requires',expected_value:values[i],provenance:{source_type:'normative_product_metadata',snapshot_id:'2j-meta',record_id:'j'+i,field:feature,source_ids:['fixture'],derivation_rule_id:null,derivation_rule_version:null}}))})
const ob=(value:string,state:'observed'|'not_visible'='observed'):SemanticObservation=>({feature_id:'drive.form',feature_family:'drive_form',value,state,visibility:state==='not_visible'?'not_visible':'visible',raw_score:null,calibrated_probability:null,calibration_status:'uncalibrated',source:'2j-provider-adapter',evidence_refs:['img'],independence_group:'img',reason_codes:state==='not_visible'?['FEATURE_NOT_VISIBLE']:['FEATURE_VISIBLE'],freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null})
const ev=(o:SemanticObservation,raw:string|null=null):SemanticEvidenceV1=>({schema_version:'hcsi.semantic-evidence.v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,extractor_version:'hcsi.candidate-blind-vlm.v1',observation_scope:{mode:'candidate_blind_first_pass',image_sha256:'a'.repeat(64),target_region_ref:'img',physical_measurements_included:false,standards_candidates_included:false,legacy_nominal_included:false,ground_truth_included:false},observations:[{...o,raw_text:raw}],unknown_or_open_set:[],evidence_sources:[],independence_groups:[],quality:{status:'usable',reason_codes:['TARGET_CLEAR']}})
async function run(cs:NominalCandidate[],meta:CandidateFeatureMetadataSnapshot,e?:SemanticEvidenceV1|null,escalator?:any,id='J'){const m=measurement();return orchestratePurchaseDecision({inference_id:id,image_ref:'upload',measurement:m,standards_authority:authority(m,cs),feature_metadata:meta,semantic_evidence:e,semantic_escalator:escalator})}
async function main(){
 const a=wr(candidate('A','M14 × 2.0'),0),b=wr(candidate('B','M14 external hex'),1),ab=[a,b],meta=metadataMany(ab,'drive.form',['hex_socket','external_hex'])
 // J1 easy production authority: no semantic cost.
 let calls=0,r=await run([a],metadata(a,'drive.form','hex_socket'),null,async()=>{calls++;throw Error('no')},'J1'),p=buildCanonicalPublicDecision(r)
 assert.equal(p.purchase_ready,true);assert.equal(p.selected_candidate_id,'A');assert.equal(calls,0);assert.equal(p.authoritative_purchase_decision_source,'phase2i_orchestrator')
 // J2 semantic resolution is candidate blind and canonical.
 r=await run(ab,meta,null,async(req:any)=>{calls++;assert.equal(req.formal_candidates_in_sensor_input,false);assert.equal(req.ground_truth_in_sensor_input,false);assert.equal(req.legacy_nominal_in_sensor_input,false);return ev(ob('hex_socket'))},'J2');p=buildCanonicalPublicDecision(r);assert.equal(p.selected_candidate_id,'A');assert.equal(p.purchase_ready,true)
 // J3 not_visible -> exact deterministic follow-up; no legacy winner leaks.
 r=await run(ab,meta,ev(ob('not_visible','not_visible')),undefined,'J3');p=buildCanonicalPublicDecision(r,{selected_candidate_id:'B',purchase_ready:true,nominal:'legacy-B',source:'legacy'});assert.equal(p.purchase_ready,false);assert.equal(p.selected_candidate_id,null);assert.equal(p.decision,'targeted_followup_required');assert.equal(p.requested_evidence?.acquisition,'drive_face_view');assert.match(p.followup_instruction??'',/螺絲頭正面/)
 // J4 legacy disagreement is diagnostic only.
 assert.equal(p.legacy_decision_diagnostic?.selected_candidate_id,'B');assert.equal(p.differential?.legacy_would_answer,true);assert.equal(p.differential?.canonical_would_answer,false)
 // J5 canonical morphology can answer while legacy abstains.
 r=await run(ab,meta,ev(ob('hex_socket')),undefined,'J5');p=buildCanonicalPublicDecision(r,{selected_candidate_id:null,purchase_ready:false,nominal:null,source:'legacy'});assert.equal(p.purchase_ready,true);assert.equal(p.selected_candidate_id,'A');assert.equal(p.differential?.canonical_would_answer,true)
 // J6 contradiction cannot fall back.
 r=await run(ab,meta,ev(ob('slotted')),undefined,'J6');p=buildCanonicalPublicDecision(r,{selected_candidate_id:'A',purchase_ready:true,nominal:'A',source:'legacy'});assert.equal(p.decision,'contradictory_evidence');assert.equal(p.selected_candidate_id,null);assert.equal(p.formal_specification,null)
 // J7 provider failure is infrastructure, safe non-purchase.
 r=await run(ab,meta,null,async()=>{throw Error('timeout')},'J7');p=buildCanonicalPublicDecision(r);assert.equal(p.infrastructure_error?.code,'semantic_provider_failure');assert.equal(p.purchase_ready,false);assert.equal(p.selected_candidate_id,null)
 // J8 renderer/public adapter ignores diagnostic legacy nominal when canonical null.
 assert.equal(buildCanonicalPublicDecision(r,{selected_candidate_id:'A',purchase_ready:true,nominal:'M14',source:'renderer'}).formal_specification,null)
 // J9 provider-neutral adapters with equivalent evidence converge identically.
 const x=buildCanonicalPublicDecision(await run(ab,meta,ev(ob('hex_socket')),undefined,'openai')),y=buildCanonicalPublicDecision(await run(ab,meta,ev(ob('hex_socket')),undefined,'grok'));assert.deepEqual([x.decision,x.selected_candidate_id],[y.decision,y.selected_candidate_id])
 // J10 provider text cannot expand formal universe.
 r=await run(ab,meta,ev(ob('not_visible','not_visible'),'#37-12 UNC'),undefined,'J10');assert.deepEqual(r.formal_candidate_ids,['A','B']);assert.equal(r.formal_candidate_ids.includes('#37-12 UNC'),false)
 // Case C through production adapter.
 const cm=measurement('c'.repeat(64));cm.observations=[['D',13.700],['P',2.051],['L_underhead',47.540],['K',9.450],['DK',25.864]].map(([quantity,value_mm])=>({quantity,value_mm})) as any
 const m14=wr(candidate('M14','M14 × 2.0',14,2),0),unc=wr({...candidate('UNC','9/16-12 UNC',14.2875,25.4/12),standard_system:'unified_inch',family:'unc'},1),empty=metadataMany([m14,unc],'drive.form',['hex_socket','hex_socket']);empty.records=[]
 const ca=authority(cm,[m14,unc]);r=await orchestratePurchaseDecision({inference_id:'CASE-C',image_ref:'case-c',measurement:cm,standards_authority:ca,feature_metadata:empty});p=buildCanonicalPublicDecision(r,{selected_candidate_id:'M14',purchase_ready:true,nominal:'#37-12',source:'legacy'})
 assert.equal(p.purchase_ready,false);assert.equal(p.selected_candidate_id,null);assert.equal(p.requested_evidence?.acquisition,'diameter_measurement');assert.equal(cm.observations.find(x=>x.quantity==='L_underhead')?.value_mm,47.540);assert.deepEqual(r.formal_candidate_ids,['M14','UNC'])
 console.log('Phase 2J production canonicalization regressions J1-J10 + Case C passed')
}
main()
