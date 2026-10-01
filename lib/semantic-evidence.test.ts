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
assert.equal(request.semantic_roi.crop_ref,'target_region_1')
const fullImageRequest=buildCandidateBlindSemanticRequest({image})
assert.equal(fullImageRequest.semantic_roi.target_region,null)
assert.equal(fullImageRequest.semantic_roi.crop_ref,'full_image_1')
const fullImageEvidence=buildSemanticEvidenceV1(validRaw(),fullImageRequest,{
  model:'mock-vlm',model_version:'mock-v1',
})
assert.equal(fullImageEvidence.evidence_sources[0].crop_ref,'full_image_1')
assert.equal(fullImageEvidence.independence_groups[0].group_id,'full_image_1')

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
assert.ok(sanitized.observations[0].reason_codes.includes('FORBIDDEN_CLAIM_REMOVED'))
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
assert.ok(dimensionSanitized.observations[4].reason_codes.includes('FORBIDDEN_CLAIM_REMOVED'))

// Phase 2B.1 anti-leak hardening regressions.

// 1 — observation reason-code nominal leak must fail closed.
{
  const raw=validRaw() as any
  raw.observations[0].reason_codes=['LIKELY_M14']
  assert.equal(validateRawSemanticSensorOutput(raw).valid,false)
  assert.throws(()=>buildSemanticEvidenceV1(raw,request,{model:'mock-vlm',model_version:'mock-v1'}),/invalid_semantic_sensor_output/)
}

// 2 — standards-system inference in observation reason code must fail closed.
{
  const raw=validRaw() as any
  raw.observations[0].reason_codes=['PROBABLY_METRIC']
  assert.equal(validateRawSemanticSensorOutput(raw).valid,false)
}

// 3 — quality reason-code leak must fail closed.
{
  const raw=validRaw() as any
  raw.quality.reason_codes=['LIKELY_UNIFIED']
  assert.equal(validateRawSemanticSensorOutput(raw).valid,false)
}

// 4 — open-set freeform standards-system inference is removed and cannot become valid evidence.
{
  const raw=validRaw()
  const tip=raw.observations.find(x=>x.feature_id==='tip.morphology')!
  tip.state='open_set'; tip.value='open_set'; tip.visibility='visible'
  tip.freeform_description='looks like a Unified thread'
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  assert.equal(sanitized.observations.find(x=>x.feature_id==='tip.morphology')!.freeform_description,null)
  assert.ok(sanitized.observations.find(x=>x.feature_id==='tip.morphology')!.reason_codes.includes('FORBIDDEN_CLAIM_REMOVED'))
  assert.equal(validateRawSemanticSensorOutput(sanitized).valid,false,
    'open_set without safe freeform description must fail closed after sanitization')
}

// 5 — candidate/winner language is removed generically, without seeing candidate list.
{
  const raw=validRaw()
  const tip=raw.observations.find(x=>x.feature_id==='tip.morphology')!
  tip.state='open_set'; tip.value='open_set'; tip.visibility='visible'
  tip.freeform_description='best candidate is M14'
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  assert.equal(tip.freeform_description,'best candidate is M14')
  assert.equal(sanitized.observations.find(x=>x.feature_id==='tip.morphology')!.freeform_description,null)
}

// 6 — valid morphology-only open-set language must survive.
{
  const raw=validRaw()
  const head=raw.observations.find(x=>x.feature_id==='head.morphology')!
  head.state='open_set'; head.value='open_set'; head.visibility='visible'
  head.freeform_description='wide low-profile head with shallow dome'
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  assert.equal(sanitized.observations.find(x=>x.feature_id==='head.morphology')!.freeform_description,
    'wide low-profile head with shallow dome')
  assert.equal(validateRawSemanticSensorOutput(sanitized).valid,true)
}

// 7 — OCR literal numeric marking remains observable transcription.
{
  const raw=validRaw()
  const ocr=raw.observations.find(x=>x.feature_id==='markings.ocr')!
  ocr.value='text_detected'; ocr.state='observed'; ocr.visibility='visible'
  ocr.raw_text='10.9'; ocr.normalized_text='MODEL SHOULD NOT CONTROL THIS'; ocr.character_confidence=0.9
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  const out=sanitized.observations.find(x=>x.feature_id==='markings.ocr')!
  assert.equal(out.raw_text,'10.9')
  assert.equal(out.normalized_text,'10.9')
  assert.equal(validateRawSemanticSensorOutput(sanitized).valid,true)
}

// 8 — OCR material-like literal marking remains literal; no domain interpretation is added.
{
  const raw=validRaw()
  const ocr=raw.observations.find(x=>x.feature_id==='markings.ocr')!
  ocr.value='text_detected'; ocr.state='observed'; ocr.visibility='partially_visible'
  ocr.raw_text='A2'; ocr.normalized_text='stainless steel'; ocr.character_confidence=0.8
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  const out=sanitized.observations.find(x=>x.feature_id==='markings.ocr')!
  assert.equal(out.raw_text,'A2')
  assert.equal(out.normalized_text,'A2')
  assert.equal(JSON.stringify(out).includes('stainless steel'),false)
  assert.equal(validateRawSemanticSensorOutput(sanitized).valid,true)
}

// Also preserve another ordinary literal marking.
{
  const raw=validRaw()
  const ocr=raw.observations.find(x=>x.feature_id==='markings.ocr')!
  ocr.value='text_detected'; ocr.state='observed'; ocr.visibility='visible'
  ocr.raw_text='304'; ocr.normalized_text='304'; ocr.character_confidence=0.7
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  assert.equal(sanitized.observations.find(x=>x.feature_id==='markings.ocr')!.raw_text,'304')
  assert.equal(validateRawSemanticSensorOutput(sanitized).valid,true)
}

// 9 — OCR engineering interpretation injection is not accepted as literal evidence.
{
  for (const injectedText of ['probably ISO metric','looks like ISO fastener','likely UNC']) {
    const raw=validRaw()
    const ocr=raw.observations.find(x=>x.feature_id==='markings.ocr')!
    ocr.value='text_detected'; ocr.state='observed'; ocr.visibility='visible'
    ocr.raw_text=injectedText; ocr.normalized_text=injectedText; ocr.character_confidence=0.9
    const sanitized=sanitizeRawSemanticSensorOutput(raw)
    const out=sanitized.observations.find(x=>x.feature_id==='markings.ocr')!
    assert.equal(out.raw_text,null)
    assert.equal(out.normalized_text,null)
    assert.equal(out.value,'unknown')
    assert.equal(out.state,'unknown')
    assert.ok(out.reason_codes.includes('FORBIDDEN_CLAIM_REMOVED'))
    assert.equal(JSON.stringify(out).includes(injectedText),false)
    assert.equal(validateRawSemanticSensorOutput(sanitized).valid,true)
  }
}

// OCR exception is literal-transcription specific: a compact printed engineering token is not
// globally blacklisted merely because a later layer may assign standards meaning to it.
{
  const raw=validRaw()
  const ocr=raw.observations.find(x=>x.feature_id==='markings.ocr')!
  ocr.value='text_detected'; ocr.state='observed'; ocr.visibility='visible'
  ocr.raw_text='UNC'; ocr.normalized_text='UNC'; ocr.character_confidence=0.9
  const sanitized=sanitizeRawSemanticSensorOutput(raw)
  assert.equal(sanitized.observations.find(x=>x.feature_id==='markings.ocr')!.raw_text,'UNC')
  assert.equal(validateRawSemanticSensorOutput(sanitized).valid,true)
}

// 10 — arbitrary unknown reason code proves the channel is finite, not keyword-blacklisted.
{
  const raw=validRaw() as any
  raw.observations[0].reason_codes=['MY_MODEL_PRIVATE_THOUGHT']
  assert.equal(validateRawSemanticSensorOutput(raw).valid,false)
}

// Quality reason code vocabulary is independently finite.
{
  const raw=validRaw() as any
  raw.quality.reason_codes=['MY_PRIVATE_QUALITY_NOTE']
  assert.equal(validateRawSemanticSensorOutput(raw).valid,false)
}

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
assert.ok(calibrationSanitized.observations[0].reason_codes.includes('UNCALIBRATED_PROBABILITY_REMOVED'))

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
