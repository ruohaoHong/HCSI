import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import { SEMANTIC_EVIDENCE_SCHEMA,SEMANTIC_EXTRACTOR_VERSION,SEMANTIC_PROMPT_VERSION,type SemanticEvidenceV1,type SemanticObservation } from './semantic-evidence-v1'
import { SEMANTIC_REASON_CODE_TAXONOMY_VERSION } from './semantic-reason-codes-v1'
import { SEMANTIC_CALIBRATION_DATASET_SCHEMA,validateSemanticCalibrationDataset,type SemanticCalibrationDatasetV1 } from './semantic-calibration-dataset-v1'
import { SEMANTIC_CALIBRATION_SCHEMA,PRODUCTION_SEMANTIC_CALIBRATION_REGISTRY,type SemanticCalibrationArtifactV1 } from './semantic-calibration-v1'
import { multiclassBrierScore,multiclassLogLoss,expectedCalibrationError,reliabilityBins } from './semantic-calibration-metrics'
import { assessSemanticLikelihoodEligibility,type SemanticRuntimeCalibrationContext } from './semantic-likelihood-eligibility'
import { buildSemanticCalibrationAssessment } from './semantic-calibration-assessment'
import { buildSemanticLikelihoodEvidence } from './semantic-likelihood-evidence-v1'
import { buildCandidateSemanticDiscrimination } from './candidate-semantic-discrimination'
import { compileCandidateFeatureMatrix } from './candidate-feature-compiler'
import { CANDIDATE_FEATURE_METADATA_V1 } from './candidate-feature-metadata-v1'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'
import { MEASUREMENT_V2_SCHEMA,type MeasurementV2 } from './measurement-v2'

function ok(v:unknown,m='assertion failed'):asserts v{if(!v)throw new Error(m)}
function eq(a:unknown,b:unknown,m='values differ'){if(a!==b)throw new Error(`${m}: ${String(a)} !== ${String(b)}`)}
function near(a:number,b:number,e=1e-12){if(Math.abs(a-b)>e)throw new Error(`${a} != ${b}`)}

function dataset(scope:SemanticCalibrationDatasetV1['source_scope']='independent_real_image',specimenId='specimen-001',splits:('calibration'|'validation')[]=['calibration']):SemanticCalibrationDatasetV1{
 return {schema_version:SEMANTIC_CALIBRATION_DATASET_SCHEMA,dataset_id:'semantic-real-v1',dataset_version:'1.0.0',created_at:'2026-10-02T00:00:00Z',source_scope:scope,
  specimens:[{specimen_id:specimenId,images:splits.map((split,i)=>({image_id:`img-${i}`,split,capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,visibility:'clear',occlusion_condition:'none',glare_condition:'none'})),ground_truth:[{feature_id:'drive.form',value:'external_hex',gt_source:'independent_fixture',verification_method:'physical_inspection',annotator_or_fixture_provenance:'fixture-ledger-v1',schema_version:'gt.v1'}]}],
  split_policy:{unit:'physical_specimen',allowed_splits:['fit','calibration','validation'],specimen_may_cross_splits:false},feature_scope:['drive.form'],sensor_scope:['vlm'],
  capture_conditions:{capture_types:['axial_head'],viewpoints:['axial'],crop_types:['head_crop'],visibility:['clear'],occlusion_conditions:['none'],glare_conditions:['none']},
  ground_truth_policy:{independently_verified:true,same_sensor_self_label_forbidden:true,provenance_required:true}}
}
function artifact(overrides:Partial<SemanticCalibrationArtifactV1>={}):SemanticCalibrationArtifactV1{
 return {schema_version:SEMANTIC_CALIBRATION_SCHEMA,calibration_id:'cal-v1',version:'1.0.0',status:'validated',
  sensor_identity:{sensor_type:'vlm',model:'mock-vlm',model_version:'v1',prompt_version:'prompt-v1',extractor_version:'extractor-v1'},
  feature_id:'drive.form',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,dataset_id:'semantic-real-v1',dataset_version:'1.0.0',
  calibration_method:{method_id:'temperature_scaling',method_version:'test-v1'},
  applicability_scope:{visibility:['visible'],capture_types:['axial_head'],viewpoints:['axial'],crop_types:['head_crop'],resolution:{min_width_px:256,min_height_px:256,max_width_px:1024,max_height_px:1024},occlusion_conditions:['none'],glare_conditions:['none']},
  metrics:{brier_score:.1,log_loss:.2,ece:.03,ece_policy_version:'equal-width-10-v1',sample_count:100,per_class_support:{external_hex:50,hex_socket:50}},
  eligibility_policy_version:'synthetic-preregistered-policy-v1',policy_status:'preregistered',production_eligible:true,...overrides}
}
const runtime:SemanticRuntimeCalibrationContext={feature_id:'drive.form',sensor_type:'vlm',model:'mock-vlm',model_version:'v1',prompt_version:'prompt-v1',extractor_version:'extractor-v1',taxonomy_version:SEMANTIC_TAXONOMY_VERSION,
 quality:{visibility:'visible',capture_type:'axial_head',viewpoint:'axial',crop_type:'head_crop',width_px:512,height_px:512,occlusion_condition:'none',glare_condition:'none'}}

// A — empty production registry means no artifact, no probability.
eq(PRODUCTION_SEMANTIC_CALIBRATION_REGISTRY.length,0)
let e=assessSemanticLikelihoodEligibility(runtime,null,null,null)
eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('no_applicable_validated_calibration_artifact'))

const ds=dataset(),dv=validateSemanticCalibrationDataset(ds);eq(dv.valid,true);eq(dv.production_eligible_source,true)
// B — model mismatch.
e=assessSemanticLikelihoodEligibility({...runtime,model_version:'v2'},artifact(),ds,dv);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('model_version_mismatch'))
// C — prompt mismatch.
e=assessSemanticLikelihoodEligibility({...runtime,prompt_version:'prompt-v2'},artifact(),ds,dv);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('prompt_version_mismatch'))
// D — feature mismatch.
e=assessSemanticLikelihoodEligibility({...runtime,feature_id:'head.morphology'},artifact(),ds,dv);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('feature_mismatch'))
// E — taxonomy mismatch.
e=assessSemanticLikelihoodEligibility({...runtime,taxonomy_version:'taxonomy-v2'},artifact(),ds,dv);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('taxonomy_version_mismatch'))
// F — quality out of scope.
e=assessSemanticLikelihoodEligibility({...runtime,quality:{...runtime.quality,viewpoint:'side'}},artifact(),ds,dv);eq(e.likelihood_eligible,false);ok(e.reason_codes.includes('runtime_quality_out_of_scope'))
// G — B/C/D/E regression fixture cannot calibrate.
for(const id of ['B','C','D','E']){const x=dataset('regression_fixture',id);const v=validateSemanticCalibrationDataset(x);eq(v.production_eligible_source,false);ok(v.reason_codes.includes('regression_fixture_dataset_forbidden')||v.reason_codes.includes('regression_fixture_forbidden'))}
// H — sealed F/G cannot calibrate.
for(const id of ['F','G']){const x=dataset('sealed_blind_fixture',id);const v=validateSemanticCalibrationDataset(x);eq(v.production_eligible_source,false);ok(v.reason_codes.some(r=>r.includes('sealed_fixture')))}
// I — synthetic math fixture is never production eligible.
const syn=dataset('synthetic_test','synthetic-1');const synv=validateSemanticCalibrationDataset(syn);eq(synv.valid,true);eq(synv.production_eligible_source,false)
e=assessSemanticLikelihoodEligibility(runtime,artifact({status:'synthetic_test_only',production_eligible:false}),syn,synv);eq(e.likelihood_eligible,false)
// J — specimen leakage invalid.
const leak=dataset('independent_real_image','specimen-leak',['calibration','validation']);const leakv=validateSemanticCalibrationDataset(leak);eq(leakv.valid,false);ok(leakv.reason_codes.includes('specimen_split_leakage'))
// K — same specimen multiple images in same split is allowed.
const same=dataset('independent_real_image','specimen-same',['calibration','calibration']);eq(validateSemanticCalibrationDataset(same).valid,true)
// L — deterministic multiclass calibration metrics.
const probs=[[.9,.1],[.2,.8],[.7,.3],[.4,.6]],labels=[0,1,1,0]
near(multiclassBrierScore(probs,labels),.45);near(multiclassLogLoss(probs,labels),.6121919007930318);near(expectedCalibrationError([.9,.8,.7,.6],[1,1,0,0],2),.25)
const bins=reliabilityBins([.9,.8,.7,.6],[1,1,0,0],2);eq(bins.reduce((s,b)=>s+b.count,0),4)

// Raw semantic fixture remains uncalibrated and immutable.
const observation:SemanticObservation={feature_id:'drive.form',feature_family:'drive_form',value:'external_hex',state:'observed',visibility:'visible',raw_score:null,calibrated_probability:null,calibration_status:'uncalibrated',source:'sensor-1',evidence_refs:['full_image_1'],independence_group:'full_image_1',reason_codes:[],freeform_description:null,raw_text:null,normalized_text:null,character_confidence:null}
const semantic:SemanticEvidenceV1={schema_version:SEMANTIC_EVIDENCE_SCHEMA,taxonomy_version:SEMANTIC_TAXONOMY_VERSION,reason_code_taxonomy_version:SEMANTIC_REASON_CODE_TAXONOMY_VERSION,extractor_version:SEMANTIC_EXTRACTOR_VERSION,observation_scope:{mode:'candidate_blind_first_pass',image_sha256:'a'.repeat(64),target_region_ref:'full_image_1',physical_measurements_included:false,standards_candidates_included:false,legacy_nominal_included:false,ground_truth_included:false},observations:[observation],unknown_or_open_set:[],evidence_sources:[{evidence_ref:'sensor-1',sensor_type:'vlm',model:'mock-vlm',model_version:'v1',prompt_version:SEMANTIC_PROMPT_VERSION,crop_ref:'full_image_1',image_sha256:'a'.repeat(64)}],independence_groups:[{group_id:'full_image_1',crop_ref:'full_image_1',image_sha256:'a'.repeat(64),description:'shared crop'}],quality:{status:'usable',reason_codes:[]}}
const before=JSON.stringify(semantic)
const assessment=buildSemanticCalibrationAssessment(semantic,[],PRODUCTION_SEMANTIC_CALIBRATION_REGISTRY,[])
eq(assessment.available,false);eq(assessment.items[0].likelihood_eligible,false);eq(assessment.items[0].calibrated_probability,null);eq(assessment.items[0].raw_score,null);eq(assessment.items[0].independence_group,'full_image_1')
const likelihood=buildSemanticLikelihoodEvidence(assessment);eq(likelihood.available,false);eq(likelihood.items[0].log_likelihood,null);eq(likelihood.items[0].calibrated_log_likelihood_ratio,null)
eq(JSON.stringify(semantic),before)

// M — qualitative supports/contradicts do not become numeric likelihood.
// N/O — candidate universe and decision stay unchanged.
const measurement={schema_version:MEASUREMENT_V2_SCHEMA,observations:[{quantity:'D',value_mm:13.700},{quantity:'P',value_mm:2.051},{quantity:'L_underhead',value_mm:47.540}],uncertainty:{schema_version:'hcsi.measurement-uncertainty.v1',quantities:[],primitives:[],covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'2d'},systematic_bias_ledger:[],systematic_bias_status:'not_estimated'}} as unknown as MeasurementV2
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1)
const m14=authority.formal_candidates.find(c=>c.designation==='M14 × 2.0')!,u916=authority.formal_candidates.find(c=>c.designation==='9/16-12 UNC')!;ok(m14&&u916)
const matrix=compileCandidateFeatureMatrix([m14,u916],CANDIDATE_FEATURE_METADATA_V1);eq(matrix.discriminative_features.length,0)
const discrimination=buildCandidateSemanticDiscrimination(matrix,semantic,[]);eq(JSON.stringify(discrimination.candidate_ids_before),JSON.stringify(discrimination.candidate_ids_after));eq(discrimination.numeric_score,null);eq(discrimination.posterior_probability,null);eq(discrimination.decision.selected_candidate_id,null);eq(discrimination.decision.purchase_ready,false)
eq((measurement.observations.find(x=>x.quantity==='D') as any).value_mm,13.700);eq((measurement.observations.find(x=>x.quantity==='P') as any).value_mm,2.051);eq((measurement.observations.find(x=>x.quantity==='L_underhead') as any).value_mm,47.540);eq(authority.formal_candidates.some(c=>/#37-12/i.test(c.designation)),false)
console.log('Phase 2D semantic calibration regressions A-O passed')
