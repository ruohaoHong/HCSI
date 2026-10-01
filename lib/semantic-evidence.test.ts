import { strict as assert } from 'node:assert'
import {
  buildCandidateBlindSemanticRequest,
  candidateBlindSemanticPromptContext,
} from './candidate-blind-semantic-request'
import { buildCandidateBlindSemanticPrompt } from './semantic-extractor'
import {
  buildSemanticEvidenceV1,
  sanitizeRawSemanticSensorOutput,
  validateRawSemanticSensorOutput,
  validateSemanticEvidenceV1,
} from './semantic-evidence-validator'
import type { RawSemanticSensorOutput, SemanticEvidenceV1 } from './semantic-evidence-v1'
import type { MeasurementV2 } from './measurement-v2'
import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { buildStandardsAuthorityResult } from './standards-shadow-solver'

const image='ZmFrZS1zZW1hbnRpYy1pbWFnZS1ieXRlcw=='

const upstreamWithSecrets={
  image,
  target_region:{present:true,confidence:0.99,x_min:100,y_min:100,x_max:900,y_max:800},
  measurement:{D:13.700,P:2.051,L_underhead:47.540},
  standards_authority:{
    formal_candidates:[
      {candidate_id:'metric:m14',designation:'M14 × 2.0',standard_system:'iso_metric',rank:1,residual:0.1},
      {candidate_id:'unified:9-16',designation:'9/16-12 UNC',standard_system:'unified_inch',rank:2,residual:0.2},
    ],
  },
  legacy_nominal:'#37-12',
  ground_truth:'M14 × 2.0 × 45',
}

const request=buildCandidateBlindSemanticRequest(upstreamWithSecrets as unknown)
const serialized=JSON.stringify(request)
for (const forbidden of [
  'M14','9/16','UNC','#37-12','candidate_id','standard_system','rank','residual',
  '13.7','2.051','47.54','ground_truth','legacy_nominal',
]) {
  assert.equal(serialized.includes(forbidden),false,`candidate-blind request leaked ${forbidden}`)
}
const prompt=buildCandidateBlindSemanticPrompt(request)
for (const secretValue of ['M14 × 2.0','9/16-12 UNC','#37-12','13.700','2.051','47.540']) {
  assert.equal(prompt.includes(secretValue),false,`semantic prompt leaked upstream value ${secretValue}`)
}
assert.deepEqual(candidateBlindSemanticPromptContext(request).semantic_roi.target_region,{
  present:true,x_min:100,y_min:100,x_max:900,y_max:800,
})

function baseObservation(feature_id:string,value:string,state:string,visibility:string) {
  return {
    feature_id,value,state,visibility,
    raw_score:null,
    calibrated_probability:null,
    calibration_status:'uncalibrated',
    reason_codes:[],
    freeform_description:null,
    raw_text:null,
    normalized_text:null,
    character_confidence:null,
  }
}

function validRaw(): RawSemanticSensorOutput {
  return {
    observations:[
      baseObservation('head.profile','protruding','observed','visible'),
      baseObservation('head.morphology','pan_like','observed','visible'),
      baseObservation('drive.form','not_visible','not_visible','not_visible'),
      baseObservation('flange_washer.feature','integral_flange_absent','not_observed','visible'),
      baseObservation('tip.morphology','chamfered','observed','partially_visible'),
      baseObservation('thread.extent','fully_threaded_visible','observed','visible'),
      baseObservation('thread.morphology','machine_thread_like','observed','visible'),
      baseObservation('markings.presence','marking_not_visible','not_visible','not_visible'),
      baseObservation('markings.ocr','text_not_visible','not_visible','not_visible'),
    ] as RawSemanticSensorOutput['observations'],
    quality:{status:'usable',reason_codes:[]},
  }
}

// 1. Valid semantic_evidence.v1 and taxonomy validation.
const evidence=buildSemanticEvidenceV1(validRaw(),request,{
  model:'mock-vlm',model_version:'mock-v1',sensor_type:'vlm',
})
assert.equal(validateSemanticEvidenceV1(evidence).valid,true)
assert.equal(evidence.schema_version,'hcsi.semantic-evidence.v1')
assert.equal(evidence.observation_scope.physical_measurements_included,false)
assert.equal(evidence.observation_scope.standards_candidates_included,false)
assert.equal(evidence.observation_scope.legacy_nominal_included,false)
assert.equal(evidence.observation_scope.ground_truth_included,false)

const invalidTaxonomy=validRaw() as any
invalidTaxonomy.observations[1].value='M14'
assert.equal(validateRawSemanticSensorOutput(invalidTaxonomy).valid,false)

// 2/3. Nominal injection cannot become normal semantic evidence.
const injected=validRaw()
injected.observations[0].freeform_description='probably 9/16-12 UNC'
const sanitized=sanitizeRawSemanticSensorOutput(injected)
assert.equal(sanitized.observations[0].freeform_description,null)
assert.ok(sanitized.observations[0].reason_codes.includes('forbidden_nominal_or_dimension_claim_removed'))
assert.equal(JSON.stringify(buildSemanticEvidenceV1(sanitized,request,{
  model:'mock-vlm',model_version:'mock-v1',
})).includes('9/16-12 UNC'),false)

const invalidValue=validRaw() as any
invalidValue.observations[1].value='M14'
assert.throws(()=>buildSemanticEvidenceV1(invalidValue,request,{
  model:'mock-vlm',model_version:'mock-v1',
}),/invalid_semantic_sensor_output/)

const dimensionLeak=validRaw()
dimensionLeak.observations[4].freeform_description='tip is about 2.0 mm'
const dimensionSanitized=sanitizeRawSemanticSensorOutput(dimensionLeak)
assert.equal(dimensionSanitized.observations[4].freeform_description,null)
assert.ok(dimensionSanitized.observations[4].reason_codes.includes('forbidden_nominal_or_dimension_claim_removed'))

// 4. not_visible is not absence.
const driveNotVisible=evidence.observations.find(x=>x.feature_id==='drive.form')!
assert.equal(driveNotVisible.state,'not_visible')
assert.equal(driveNotVisible.value,'not_visible')
const visibleNoDrive=validRaw()
const drive=visibleNoDrive.observations.find(x=>x.feature_id==='drive.form')!
drive.state='observed'; drive.visibility='visible'; drive.value='none_visible'
assert.equal(validateRawSemanticSensorOutput(visibleNoDrive).valid,true)
assert.notEqual(drive.value,'not_visible')

// 5. Open-set is first-class and not forced to nearest class.
const openSet=validRaw()
const tip=openSet.observations.find(x=>x.feature_id==='tip.morphology')!
tip.state='open_set'; tip.value='open_set'; tip.visibility='visible'
tip.freeform_description='blunt stepped tip with twin flats'
const openEvidence=buildSemanticEvidenceV1(openSet,request,{
  model:'mock-vlm',model_version:'mock-v1',
})
assert.ok(openEvidence.unknown_or_open_set.includes('tip.morphology'))
assert.equal(openEvidence.observations.find(x=>x.feature_id==='tip.morphology')?.value,'open_set')

// 6. Calibration honesty: raw score may exist, calibrated probability may not be invented.
const scored=validRaw()
scored.observations[0].raw_score=0.74
assert.equal(validateRawSemanticSensorOutput(scored).valid,true)
assert.equal(scored.observations[0].calibrated_probability,null)
const fakeCalibration=validRaw()
fakeCalibration.observations[0].calibrated_probability=0.74
assert.equal(validateRawSemanticSensorOutput(fakeCalibration).valid,false)
const calibrationSanitized=sanitizeRawSemanticSensorOutput(fakeCalibration)
assert.equal(calibrationSanitized.observations[0].calibrated_probability,null)
assert.ok(calibrationSanitized.observations[0].reason_codes.includes('uncalibrated_probability_removed'))

// 7. Same crop, multiple sensors => same independence group, not independent evidence.
const multiSensor:SemanticEvidenceV1=JSON.parse(JSON.stringify(evidence))
const head=multiSensor.observations.find(x=>x.feature_id==='head.morphology')!
multiSensor.evidence_sources.push({
  evidence_ref:'head_classifier_1',
  sensor_type:'deterministic_classifier',
  model:'mock-head-classifier',
  model_version:'v1',
  prompt_version:'none',
  crop_ref:'target_region_1',
  image_sha256:request.image.image_sha256,
})
multiSensor.observations.push({
  ...head,
  source:'head_classifier_1',
  raw_score:0.81,
  calibrated_probability:null,
  calibration_status:'uncalibrated',
  independence_group:'target_region_1',
})
assert.equal(validateSemanticEvidenceV1(multiSensor).valid,true)
const headObservations=multiSensor.observations.filter(x=>x.feature_id==='head.morphology')
assert.equal(headObservations.length,2)
assert.equal(new Set(headObservations.map(x=>x.independence_group)).size,1)

// 8/9/10. Semantic first pass cannot mutate measurement, candidate universe or decision.
const measurement={
  schema_version:'hcsi.measurement.v2',
  source_schema_version:'hcsi.measurement.v1',
  image_sha256:'a'.repeat(64),
  observations:[
    {quantity:'D',value_mm:13.700,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
    {quantity:'P',value_mm:2.051,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
    {quantity:'L_underhead',value_mm:47.540,value_px:null,confidence:'verified',risk_signals:[],reason_codes:[],evidence_refs:[]},
  ],
  head_geometry:null,
  scale:{system:'metric',px_per_cm:100,px_per_inch:254,source:'metric_ticks',confidence:1},
  capture_assumptions:{
    same_plane_required:true,same_plane_verified:false,same_plane_status:'unknown',
    near_overhead_required:true,near_overhead_status:'unknown',
    ruler_parallel_required:false,ruler_parallel_preferred:true,
  },
  uncertainty:{
    schema_version:'hcsi.measurement-uncertainty.v1',
    quantities:[],primitives:[],
    covariance:{quantities:[],matrix_mm2:[],status:'not_estimated',null_semantics:'not_estimated',note:'synthetic'},
    systematic_bias_ledger:[],
    systematic_bias_status:'not_estimated',
  },
  immutability:{raw_measurements_are_nominally_snapped:false,nominal_solver_may_modify_measurement:false},
} as unknown as MeasurementV2

const measurementBefore=JSON.stringify(measurement)
const authority=buildStandardsAuthorityResult(measurement,STANDARDS_CATALOGUE_V1,{
  llmNominal:'#37-12',
})
const candidateIdsBefore=authority.formal_candidates.map(x=>x.candidate_id)
const decisionBefore=JSON.stringify(authority.decision)

buildSemanticEvidenceV1(validRaw(),request,{model:'mock-vlm',model_version:'mock-v1'})

assert.equal(JSON.stringify(measurement),measurementBefore)
assert.deepEqual(authority.formal_candidates.map(x=>x.candidate_id),candidateIdsBefore)
assert.equal(JSON.stringify(authority.decision),decisionBefore)
assert.equal(authority.decision.selected_candidate_id,null)
assert.equal(authority.decision.purchase_ready,false)
assert.ok(authority.formal_candidates.some(x=>x.designation==='M14 × 2.0'))
assert.ok(authority.formal_candidates.some(x=>x.designation==='9/16-12 UNC'))
assert.equal(authority.formal_candidates.some(x=>x.designation.includes('#37-12')),false)

console.log('semantic_evidence.v1: schema/taxonomy, candidate blindness, anti-leak, open-set, calibration, independence, immutability passed')
