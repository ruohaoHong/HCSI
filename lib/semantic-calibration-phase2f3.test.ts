import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SEMANTIC_CALIBRATION_DATASET_SCHEMA,
  finalizeSemanticCalibrationDataset,
  type SemanticCalibrationDatasetV1,
  type SemanticCalibrationDatasetContentDraft,
} from './semantic-calibration-dataset-v1'
import {
  SEMANTIC_CALIBRATION_SCHEMA,
  finalizeSemanticCalibrationArtifact,
  type SemanticCalibrationArtifactV1,
} from './semantic-calibration-v1'
import {
  SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,
  finalizeCalibrationHeldOutValidation,
  type CalibrationHeldOutValidation,
} from './semantic-calibration-validation'
import {
  ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1,
  PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY,
  assessSemanticCalibrationPolicyRevision,
  finalizeSemanticCalibrationEligibilityPolicy,
  validateSemanticCalibrationEligibilityPolicy,
  type SemanticCalibrationEligibilityPolicyDraftV1,
  type SemanticCalibrationEligibilityPolicyV1,
} from './semantic-calibration-policy-v1'
import { exactOneSidedClopperPearsonUpper } from './semantic-calibration-statistics'
import { assessCalibrationArtifactAdmission } from './semantic-calibration-admission'
import { validateSemanticCalibrationDataset } from './semantic-calibration-dataset-v1'
import {
  SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
  type CalibrationSensorIdentityV1,
} from './semantic-calibration-lineage-v1'
import {
  fitSemanticCalibrationArtifact,
  type CalibrationEstimatorConfigV1,
} from './semantic-calibration-fit'
import {
  SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
  type SemanticSensorObservationRecordV1,
} from './semantic-sensor-observation-record-v1'
import { SEMANTIC_TAXONOMY_VERSION } from './semantic-taxonomy-v1'
import {
  intakeRealSemanticCalibrationCorpus,
  type SemanticCalibrationRealCorpusIntakeBundleV1,
} from './semantic-calibration-corpus-files'
import {
  ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,
  PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,
  SEMANTIC_CALIBRATION_REGISTRY,
} from './semantic-calibration-registry'

const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const policy=PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1
const classes=[...PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES]
const sensor:CalibrationSensorIdentityV1={...policy.required_sensor_identity}

function refinalizeDataset(dataset:SemanticCalibrationDatasetV1):SemanticCalibrationDatasetV1{
  const {dataset_content_digest_sha256:_digest,...draft}=dataset
  return finalizeSemanticCalibrationDataset(draft)
}

function revisePolicy(mutator:(draft:SemanticCalibrationEligibilityPolicyDraftV1)=>void):SemanticCalibrationEligibilityPolicyV1{
  const copy=clone(policy)
  const {policy_content_digest_sha256:_digest,...draft}=copy
  mutator(draft)
  return finalizeSemanticCalibrationEligibilityPolicy(draft)
}

function makeDataset(
  requiredClasses:readonly string[]=classes,
  calibrationPerClass:Record<string,number>=Object.fromEntries(requiredClasses.map(c=>[c,29])),
  validationPerClass:Record<string,number>=Object.fromEntries(requiredClasses.map(c=>[c,29])),
  sourceScope:SemanticCalibrationDatasetV1['source_scope']='independent_real_image',
):SemanticCalibrationDatasetV1{
  const specimens:SemanticCalibrationDatasetContentDraft['specimens']=[]
  const add=(split:'calibration'|'validation',gt:string,count:number)=>{
    for(let i=0;i<count;i++){
      const specimen_id=`${split}-${gt}-${String(i+1).padStart(2,'0')}`
      const image_id=`${specimen_id}-img`
      specimens.push({
        specimen_id,
        provenance:{
          source_class:sourceScope,
          source_ref:`memory://phase2f3/${specimen_id}`,
          physical_identity_verified:true,
        },
        images:[{
          image_id,
          sha256:hash(image_id),
          source_ref:`memory://phase2f3/${image_id}`,
          split,
          capture_type:'user_uploaded_single_image',
          viewpoint:'drive_face_visible',
          crop_type:'full_image',
          width_px:512,
          height_px:512,
          visibility:'visible',
          occlusion_condition:'none',
          glare_condition:'none',
        }],
        ground_truth:[{
          feature_id:'drive.form',
          value:gt,
          gt_source:`gt://phase2f3/${specimen_id}`,
          verification_method:'independent_physical_inspection',
          annotator_or_fixture_provenance:'phase2f3-deterministic-policy-fixture',
          schema_version:'gt.v1',
        }],
      })
    }
  }
  for(const gt of requiredClasses){
    add('calibration',gt,calibrationPerClass[gt]??0)
    add('validation',gt,validationPerClass[gt]??0)
  }
  return finalizeSemanticCalibrationDataset({
    schema_version:SEMANTIC_CALIBRATION_DATASET_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    dataset_id:`phase2f3-${requiredClasses.join('-')}-dataset`,
    dataset_version:'1.0.0',
    manifest_digest_sha256:hash(`manifest:${requiredClasses.join(',')}:${JSON.stringify(calibrationPerClass)}:${JSON.stringify(validationPerClass)}:${sourceScope}`),
    created_at:'2026-10-03T15:06:00Z',
    source_scope:sourceScope,
    source_provenance:{
      source_class:sourceScope,
      source_ref:'memory://phase2f3-policy-fixture',
      independent_acquisition:sourceScope==='independent_real_image',
    },
    specimens,
    split_policy:{unit:'physical_specimen',allowed_splits:['fit','calibration','validation'],specimen_may_cross_splits:false},
    feature_scope:['drive.form'],
    sensor_scope:['vlm'],
    capture_conditions:{
      capture_types:['user_uploaded_single_image'],
      viewpoints:['drive_face_visible'],
      crop_types:['full_image'],
      visibility:['visible'],
      occlusion_conditions:['none'],
      glare_conditions:['none'],
    },
    ground_truth_policy:{
      independently_verified:true,
      same_sensor_self_label_forbidden:true,
      provenance_required:true,
    },
  })
}

function artifactFor(
  dataset:SemanticCalibrationDatasetV1,
  overrides:Partial<Omit<SemanticCalibrationArtifactV1,'artifact_digest_sha256'>>={},
):SemanticCalibrationArtifactV1{
  const base={
    schema_version:SEMANTIC_CALIBRATION_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    calibration_id:'phase2f3-artifact',
    version:'1.0.0',
    source_fit_id:'phase2f3-fit',
    source_fit_digest_sha256:hash('phase2f3-fit'),
    status:'validated' as const,
    sensor_identity:{
      sensor_type:sensor.sensor_type,
      model:sensor.model,
      model_version:sensor.model_version,
      prompt_version:sensor.prompt_version,
      extractor_version:sensor.extractor_version,
    },
    feature_id:'drive.form' as const,
    taxonomy_version:sensor.taxonomy_version,
    dataset_id:dataset.dataset_id,
    dataset_version:dataset.dataset_version,
    dataset_manifest_digest_sha256:dataset.manifest_digest_sha256,
    dataset_content_digest_sha256:dataset.dataset_content_digest_sha256,
    estimator_config_digest_sha256:hash('phase2f3-estimator'),
    calibration_method:{method_id:'categorical_confusion_counts',method_version:'v1'},
    calibration_payload:null,
    applicability_scope:{
      visibility:['visible'],
      capture_types:['user_uploaded_single_image'],
      viewpoints:['drive_face_visible'],
      crop_types:['full_image'],
      resolution:{min_width_px:256,min_height_px:256,max_width_px:null,max_height_px:null},
      occlusion_conditions:['none'],
      glare_conditions:['none'],
    },
    metrics:{
      brier_score:null,log_loss:null,ece:null,ece_policy_version:null,
      sample_count:0,per_class_support:{},
    },
    eligibility_policy_version:policy.policy_version,
  }
  return finalizeSemanticCalibrationArtifact({...base,...overrides})
}

function validationFor(
  dataset:SemanticCalibrationDatasetV1,
  artifact:SemanticCalibrationArtifactV1,
  errorSpecimens:Set<string>=new Set(),
  validationOutcomeRepeat:Record<string,number>={},
):CalibrationHeldOutValidation{
  const calibrationSpecimens=dataset.specimens.filter(s=>s.images[0]?.split==='calibration')
  const validationSpecimens=dataset.specimens.filter(s=>s.images[0]?.split==='validation')
  const calibrationBindings=calibrationSpecimens.map(s=>({
    run_id:`cal-run-${s.specimen_id}`,
    specimen_id:s.specimen_id,
    image_id:s.images[0].image_id,
  }))
  const outcomes=validationSpecimens.flatMap(s=>{
    const gt=s.ground_truth.find(g=>g.feature_id==='drive.form')!.value
    const repeat=validationOutcomeRepeat[s.specimen_id]??1
    return Array.from({length:repeat},(_,i)=>({
      run_id:`val-run-${s.specimen_id}-${i+1}`,
      specimen_id:s.specimen_id,
      image_id:s.images[0].image_id,
      gt_class:gt,
      error:errorSpecimens.has(s.specimen_id),
    }))
  })
  const calPerClass:Record<string,number>={}
  for(const s of calibrationSpecimens){
    const gt=s.ground_truth[0].value
    calPerClass[gt]=(calPerClass[gt]??0)+1
  }
  const valPerClass:Record<string,number>={}
  const errorsPerClass:Record<string,number>={}
  for(const s of validationSpecimens){
    const gt=s.ground_truth[0].value
    valPerClass[gt]=(valPerClass[gt]??0)+1
    if(errorSpecimens.has(s.specimen_id)) errorsPerClass[gt]=(errorsPerClass[gt]??0)+1
  }
  const correctUnique=validationSpecimens.length-errorSpecimens.size
  return finalizeCalibrationHeldOutValidation({
    schema_version:SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    status:'validated',
    split:'validation',
    estimator_locked_before_validation:true,
    validation_used_for_tuning:false,
    artifact_id:artifact.calibration_id,
    artifact_version:artifact.version,
    artifact_digest_sha256:artifact.artifact_digest_sha256,
    source_fit_id:artifact.source_fit_id,
    source_fit_digest_sha256:artifact.source_fit_digest_sha256,
    dataset_id:dataset.dataset_id,
    dataset_version:dataset.dataset_version,
    dataset_manifest_digest_sha256:dataset.manifest_digest_sha256,
    dataset_content_digest_sha256:dataset.dataset_content_digest_sha256,
    feature_id:artifact.feature_id,
    sensor_identity:{...artifact.sensor_identity,taxonomy_version:artifact.taxonomy_version},
    taxonomy_version:artifact.taxonomy_version,
    estimator_config_digest_sha256:artifact.estimator_config_digest_sha256,
    sample_count:outcomes.length,
    per_class_support:Object.fromEntries(classes.map(gt=>[gt,outcomes.filter(o=>o.gt_class===gt).length]).filter(([,n])=>n)),
    quality_strata_support:{'policy-envelope':outcomes.length},
    accuracy:validationSpecimens.length?correctUnique/validationSpecimens.length:null,
    brier_score:null,log_loss:null,ece:null,ece_policy_version:null,reliability_bins:null,
    metric_reason_codes:['brier_log_loss_ece_diagnostic_only_in_phase2f3'],
    source_fit_calibration_specimen_ids:calibrationSpecimens.map(s=>s.specimen_id),
    source_fit_calibration_record_ids:calibrationBindings.map(b=>b.run_id),
    source_fit_calibration_observation_bindings:calibrationBindings,
    source_fit_unique_calibration_specimen_count:calibrationSpecimens.length,
    source_fit_unique_calibration_specimens_per_class:calPerClass,
    validation_specimen_ids:validationSpecimens.map(s=>s.specimen_id),
    validation_record_ids:outcomes.map(o=>o.run_id),
    validation_observation_outcomes:outcomes,
    unique_validation_specimen_count:validationSpecimens.length,
    unique_validation_specimens_per_class:valPerClass,
    unique_validation_errors_per_class:errorsPerClass,
    reason_codes:[],
  })
}

function admission(
  dataset:SemanticCalibrationDatasetV1,
  artifact=artifactFor(dataset),
  validation=validationFor(dataset,artifact),
  p:SemanticCalibrationEligibilityPolicyV1|null=policy,
){
  return assessCalibrationArtifactAdmission(
    artifact,dataset,validateSemanticCalibrationDataset(dataset),validation,p,
  )
}

function reviseArtifactAndValidation(
  dataset:SemanticCalibrationDatasetV1,
  artifact:SemanticCalibrationArtifactV1,
  validation:CalibrationHeldOutValidation,
  artifactOverrides:Partial<Omit<SemanticCalibrationArtifactV1,'artifact_digest_sha256'>>,
  validationOverrides:Partial<Omit<CalibrationHeldOutValidation,'validation_id'|'validation_digest_sha256'>>={},
){
  const {artifact_digest_sha256:_digest,...artifactDraft}=artifact
  const revisedArtifact=finalizeSemanticCalibrationArtifact({...artifactDraft,...artifactOverrides})
  const {validation_id:_id,validation_digest_sha256:_vd,...validationDraft}=validation
  const revisedValidation=finalizeCalibrationHeldOutValidation({
    ...validationDraft,
    artifact_id:revisedArtifact.calibration_id,
    artifact_version:revisedArtifact.version,
    artifact_digest_sha256:revisedArtifact.artifact_digest_sha256,
    feature_id:revisedArtifact.feature_id,
    sensor_identity:{...revisedArtifact.sensor_identity,taxonomy_version:revisedArtifact.taxonomy_version},
    taxonomy_version:revisedArtifact.taxonomy_version,
    ...validationOverrides,
  })
  return {artifact:revisedArtifact,validation:revisedValidation}
}

// Frozen policy identity and product-owner parameters.
assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,1)
assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY,policy)
assert.equal(policy.policy_id,'hcsi-production-semantic-calibration-policy-drive-form-v1')
assert.equal(policy.policy_version,'1.0.0')
assert.equal(policy.status,'preregistered')
assert.ok(policy.locked_at)
assert.equal(validateSemanticCalibrationEligibilityPolicy(policy).valid,true)
assert.equal(policy.held_out_error_requirement.maximum_error_risk,0.10)
assert.equal(policy.held_out_error_requirement.confidence_level,0.95)
assert.equal(policy.held_out_error_requirement.method,'exact_clopper_pearson')
assert.equal(policy.minimum_support.calibration_unique_specimens_per_class.minimum,29)
assert.equal(policy.minimum_support.validation_unique_specimens_per_class.minimum,29)
assert.deepEqual(policy.minimum_support.required_classes,classes)
assert.deepEqual(policy.allowed_source_scopes,['independent_real_image'])
assert.deepEqual(policy.required_sensor_identity,{
  sensor_type:'vlm',
  model:'gpt-5.6-sol',
  model_version:'gpt-5.6-sol',
  prompt_version:'hcsi.semantic-first-pass.prompt.v1',
  extractor_version:'hcsi.candidate-blind-vlm.v1',
  taxonomy_version:'hcsi.semantic-taxonomy.v1',
})

// Exact CP boundary and non-zero error oracle.
const cp0of28=exactOneSidedClopperPearsonUpper(0,28,.95)
const cp0of29=exactOneSidedClopperPearsonUpper(0,29,.95)
const cp1of29=exactOneSidedClopperPearsonUpper(1,29,.95)
const cp1of50=exactOneSidedClopperPearsonUpper(1,50,.95)
assert.ok(Math.abs(cp0of28-0.1014657355727247)<1e-12)
assert.ok(Math.abs(cp0of29-0.09814462767729576)<1e-12)
assert.ok(Math.abs(cp1of29-0.15339202452618267)<1e-12)
assert.ok(Math.abs(cp1of50-0.09139813071969743)<1e-12)

// Q1 — no preregistered policy => admission impossible.
{
  const dataset=makeDataset()
  const result=admission(dataset,artifactFor(dataset),validationFor(dataset,artifactFor(dataset)),null)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('active_preregistered_policy_missing'))
}

// Q2 — draft policy cannot authorize admission.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const draft=revisePolicy(p=>{p.status='draft_not_preregistered';p.locked_at=null})
  const result=admission(dataset,artifact,validation,draft)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('active_preregistered_policy_missing'))
}

// Q3 — preregistered + locked_at=null fails closed.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const unlocked=revisePolicy(p=>{p.locked_at=null})
  const result=admission(dataset,artifact,validation,unlocked)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('preregistered_policy_not_locked'))
}

// Q4 — wrong source scope is production-ineligible.
{
  const dataset=makeDataset(classes,undefined,undefined,'synthetic_test')
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('dataset_not_production_eligible')||
            result.reason_codes.includes('dataset_source_scope_not_allowed_by_policy'))
}

// Q5 — normalized GT policy that permits same-sensor self-label fails closed.
{
  const dataset=makeDataset()
  const broken=refinalizeDataset({
    ...dataset,
    ground_truth_policy:{...dataset.ground_truth_policy,same_sensor_self_label_forbidden:false as true},
  })
  const artifact=artifactFor(broken)
  const validation=validationFor(broken,artifact)
  const result=admission(broken,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('ground_truth_self_label_forbidden')||
            result.reason_codes.includes('ground_truth_policy_not_independent'))
}

// Q6 — missing GT provenance rejects.
{
  const dataset=makeDataset()
  const mutated=clone(dataset)
  mutated.specimens[0].ground_truth[0].gt_source=''
  const broken=refinalizeDataset(mutated)
  const artifact=artifactFor(broken)
  const validation=validationFor(broken,artifact)
  const result=admission(broken,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('ground_truth_provenance_missing'))
}

// Q7 — same physical specimen cannot cross calibration/validation.
{
  const dataset=makeDataset()
  const mutated=clone(dataset)
  const s=mutated.specimens.find(x=>x.images[0].split==='calibration')!
  s.images.push({...s.images[0],image_id:s.images[0].image_id+'-validation',sha256:hash('cross-split'),split:'validation'})
  const broken=refinalizeDataset(mutated)
  const artifact=artifactFor(broken)
  const validation=validationFor(broken,artifact)
  const result=admission(broken,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('specimen_split_leakage')||
            result.reason_codes.includes('physical_specimen_crosses_splits'))
}

// Q8 — required validation split missing.
{
  const dataset=makeDataset(classes,Object.fromEntries(classes.map(c=>[c,29])),Object.fromEntries(classes.map(c=>[c,0])))
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('required_validation_split_missing'))
}

// Q9 — insufficient total unique specimen support rejects.
{
  const count28=Object.fromEntries(classes.map(c=>[c,28]))
  const dataset=makeDataset(classes,count28,count28)
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.some(x=>x.startsWith('minimum_calibration_unique_specimen_support_not_met:')))
  assert.ok(result.reason_codes.some(x=>x.startsWith('minimum_validation_unique_specimen_support_not_met:')))
}

// Q10 — one under-supported class fails even when all others satisfy support.
{
  const cal=Object.fromEntries(classes.map(c=>[c,29]))
  const val=Object.fromEntries(classes.map(c=>[c,c==='combination'?28:29]))
  const dataset=makeDataset(classes,cal,val)
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('minimum_validation_unique_specimen_support_not_met:combination'))
}

// Q11 — wrong sensor identity rejects.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const changed=reviseArtifactAndValidation(dataset,artifact,validation,{
    sensor_identity:{...artifact.sensor_identity,model:'other-model'},
  })
  const result=admission(dataset,changed.artifact,changed.validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('policy_sensor_identity_mismatch'))
}

// Q12 — wrong feature rejects.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const changed=reviseArtifactAndValidation(dataset,artifact,validation,{feature_id:'head.morphology'})
  const result=admission(dataset,changed.artifact,changed.validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('policy_feature_mismatch'))
}

// Q13 — wrong taxonomy rejects.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const changed=reviseArtifactAndValidation(dataset,artifact,validation,{taxonomy_version:'hcsi.semantic-taxonomy.v999'})
  const result=admission(dataset,changed.artifact,changed.validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('policy_sensor_identity_mismatch')||
            result.reason_codes.includes('policy_taxonomy_mismatch'))
}

// Q14 — model/model-version/prompt/extractor identity changes each reject.
for(const [field,value] of [
  ['model','different-model'],
  ['model_version','different-model-version'],
  ['prompt_version','different-prompt'],
  ['extractor_version','different-extractor'],
] as const){
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const changed=reviseArtifactAndValidation(dataset,artifact,validation,{
    sensor_identity:{...artifact.sensor_identity,[field]:value},
  })
  const result=admission(dataset,changed.artifact,changed.validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('policy_sensor_identity_mismatch'))
}

// Q15 — required + null never becomes implicit pass.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const brokenSupport=revisePolicy(p=>{
    p.minimum_support.validation_unique_specimens_per_class={required:true,minimum:null}
  })
  const r1=admission(dataset,artifact,validation,brokenSupport)
  assert.equal(r1.eligible_for_admission,false)
  assert.ok(r1.reason_codes.includes('required_validation_support_not_configured'))

  const brokenMetric=revisePolicy(p=>{
    p.metric_requirements.brier_score={required:true,threshold:null}
  })
  const r2=admission(dataset,artifact,validation,brokenMetric)
  assert.equal(r2.eligible_for_admission,false)
  assert.ok(r2.reason_codes.includes('brier_requirement_invalid')||
            r2.reason_codes.includes('brier_score_required_threshold_missing'))
}

// Q16 — nonzero held-out error exceeding preregistered risk rejects per class.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const errSpec=dataset.specimens.find(s=>s.images[0].split==='validation'&&s.ground_truth[0].value==='hex_socket')!
  const validation=validationFor(dataset,artifact,new Set([errSpec.specimen_id]))
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('held_out_error_upper_bound_exceeded:hex_socket'))
  assert.ok((result.statistical_authority.validation_error_upper_bound_per_class.hex_socket??0)>.10)
}

// Q17 — all preregistered conditions satisfied => eligible only; no automatic registry mutation.
const fullDataset=makeDataset()
const fullArtifact=artifactFor(fullDataset)
const fullValidation=validationFor(fullDataset,fullArtifact)
const fullResult=admission(fullDataset,fullArtifact,fullValidation)
assert.equal(fullResult.eligible_for_admission,true)
assert.equal(fullResult.admitted_to_production_registry,false)
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)

// Q18 — locked preregistered policy cannot change in-place; new version required.
{
  assert.equal(Object.isFrozen(policy),true)
  const changedSameVersion=revisePolicy(p=>{
    p.capture_applicability.resolution.min_width_px=300
  })
  const revision=assessSemanticCalibrationPolicyRevision(policy,changedSameVersion)
  assert.equal(revision.valid,false)
  assert.ok(revision.reason_codes.includes('locked_policy_mutation_requires_new_version'))

  const changedNewVersion=revisePolicy(p=>{
    p.policy_version='1.1.0'
    p.capture_applicability.resolution.min_width_px=300
  })
  assert.equal(assessSemanticCalibrationPolicyRevision(policy,changedNewVersion).valid,true)
}

// Q19 — validation records cannot be used as calibration fit inputs.
{
  const oneClass=['hex_socket']
  const dataset=makeDataset(oneClass,{hex_socket:1},{hex_socket:1})
  const calSpec=dataset.specimens.find(s=>s.images[0].split==='calibration')!
  const valSpec=dataset.specimens.find(s=>s.images[0].split==='validation')!
  const record=(specimen:typeof calSpec,run_id:string):SemanticSensorObservationRecordV1=>({
    schema_version:SEMANTIC_SENSOR_OBSERVATION_RECORD_SCHEMA,
    specimen_id:specimen.specimen_id,
    image_id:specimen.images[0].image_id,
    feature_id:'drive.form',
    observation_stage:'candidate_blind_first_pass',
    sensor_type:'vlm',
    model:sensor.model,
    model_version:sensor.model_version,
    prompt_version:sensor.prompt_version,
    extractor_version:sensor.extractor_version,
    taxonomy_version:sensor.taxonomy_version,
    value:'hex_socket',
    state:'observed',
    visibility:'visible',
    raw_score:null,
    observed_at:'2026-10-03T15:06:00Z',
    run_id,
    image_sha256:specimen.images[0].sha256,
    crop_ref:'full_image_1',
    independence_group:specimen.images[0].image_id,
    ground_truth_in_prompt:false,
  })
  const config:CalibrationEstimatorConfigV1={
    config_id:'phase2f3-fit-boundary',
    config_version:'1.0.0',
    feature_id:'drive.form',
    sensor_identity:{...sensor},
    estimator:{method:'categorical_confusion_counts',smoothing:'none'},
    eligibility_policy_version:policy.policy_version,
    locked:true,
  }
  const fit=fitSemanticCalibrationArtifact(dataset,[record(calSpec,'cal-run'),record(valSpec,'val-run')],config)
  assert.notEqual(fit.status,'candidate_artifact')
  assert.ok(fit.reason_codes.includes('calibration_record_split_mismatch'))
}

// Q20 — current real-2026-001 alone remains production-ineligible and unobserved.
{
  const repoRoot=process.cwd()
  const bundle=JSON.parse(readFileSync(
    resolve(repoRoot,'data/semantic-calibration/manifests/real-2026-001-intake-bundle.json'),'utf8',
  )) as SemanticCalibrationRealCorpusIntakeBundleV1
  const intake=intakeRealSemanticCalibrationCorpus(bundle,repoRoot)
  assert.equal(intake.accepted,true)
  assert.ok(intake.dataset)
  const realDataset=intake.dataset
  assert.equal(realDataset.specimens.length,1)
  assert.equal(realDataset.specimens[0].images[0].split,'calibration')
  assert.equal(bundle.acquisition_ledger.entries[0].semantic_sensor_observation_started_at,null)

  const artifact=artifactFor(realDataset)
  const validation=finalizeCalibrationHeldOutValidation({
    schema_version:SEMANTIC_CALIBRATION_VALIDATION_SCHEMA,
    lineage_schema_version:SEMANTIC_CALIBRATION_LINEAGE_SCHEMA,
    status:'validated',split:'validation',estimator_locked_before_validation:true,validation_used_for_tuning:false,
    artifact_id:artifact.calibration_id,artifact_version:artifact.version,artifact_digest_sha256:artifact.artifact_digest_sha256,
    source_fit_id:artifact.source_fit_id,source_fit_digest_sha256:artifact.source_fit_digest_sha256,
    dataset_id:realDataset.dataset_id,dataset_version:realDataset.dataset_version,
    dataset_manifest_digest_sha256:realDataset.manifest_digest_sha256,
    dataset_content_digest_sha256:realDataset.dataset_content_digest_sha256,
    feature_id:'drive.form',sensor_identity:{...sensor},taxonomy_version:sensor.taxonomy_version,
    estimator_config_digest_sha256:artifact.estimator_config_digest_sha256,
    sample_count:0,per_class_support:{},quality_strata_support:{},accuracy:null,
    brier_score:null,log_loss:null,ece:null,ece_policy_version:null,reliability_bins:null,
    metric_reason_codes:[],
    source_fit_calibration_specimen_ids:[],source_fit_calibration_record_ids:[],
    source_fit_calibration_observation_bindings:[],
    source_fit_unique_calibration_specimen_count:0,
    source_fit_unique_calibration_specimens_per_class:{},
    validation_specimen_ids:[],validation_record_ids:[],validation_observation_outcomes:[],
    unique_validation_specimen_count:0,unique_validation_specimens_per_class:{},unique_validation_errors_per_class:{},
    reason_codes:[],
  })
  const result=admission(realDataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('required_validation_split_missing'))
  assert.ok(result.reason_codes.some(x=>x.startsWith('minimum_calibration_unique_specimen_support_not_met:')))
}

// S1/S2 — exact zero-error boundary.
assert.ok(cp0of28>.10)
assert.ok(cp0of29<.10)

// S3 — 29 observations of one specimen count as N=1.
{
  const one=['hex_socket']
  const onePolicy=revisePolicy(p=>{
    p.minimum_support.required_classes=[...one]
    p.minimum_support.calibration_unique_specimens_per_class={required:true,minimum:29}
    p.minimum_support.validation_unique_specimens_per_class={required:true,minimum:29}
  })
  const dataset=makeDataset(one,{hex_socket:29},{hex_socket:1})
  const artifact=artifactFor(dataset)
  const valSpec=dataset.specimens.find(s=>s.images[0].split==='validation')!
  const validation=validationFor(dataset,artifact,new Set(),{[valSpec.specimen_id]:29})
  const result=admission(dataset,artifact,validation,onePolicy)
  assert.equal(result.statistical_authority.validation_unique_specimens_per_class.hex_socket,1)
  assert.equal(result.eligible_for_admission,false)
}

// S4 — 29 different validation specimens count as N=29.
{
  const one=['hex_socket']
  const onePolicy=revisePolicy(p=>{p.minimum_support.required_classes=[...one]})
  const dataset=makeDataset(one,{hex_socket:29},{hex_socket:29})
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation,onePolicy)
  assert.equal(result.statistical_authority.validation_unique_specimens_per_class.hex_socket,29)
  assert.equal(result.eligible_for_admission,true)
}

// S5 — one required class at 28 rejects.
{
  const cal=Object.fromEntries(classes.map(c=>[c,29]))
  const val=Object.fromEntries(classes.map(c=>[c,c==='pozidriv_like'?28:29]))
  const dataset=makeDataset(classes,cal,val)
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('minimum_validation_unique_specimen_support_not_met:pozidriv_like'))
}

// S6 — calibration/validation specimen overlap rejects.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset)
  const validation=validationFor(dataset,artifact)
  const valId=validation.validation_specimen_ids[0]
  const {validation_id:_id,validation_digest_sha256:_d,...draft}=validation
  const overlapped=finalizeCalibrationHeldOutValidation({
    ...draft,
    source_fit_calibration_specimen_ids:[...draft.source_fit_calibration_specimen_ids,valId],
  })
  const result=admission(dataset,artifact,overlapped)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('validation_calibration_data_overlap'))
}

// S7 — all 8 classes × 29 calibration + 29 validation can pass support/risk gate.
assert.equal(fullResult.eligible_for_admission,true)
for(const gt of classes){
  assert.equal(fullResult.statistical_authority.calibration_unique_specimens_per_class[gt],29)
  assert.equal(fullResult.statistical_authority.validation_unique_specimens_per_class[gt],29)
  assert.equal(fullResult.statistical_authority.validation_unique_errors_per_class[gt]??0,0)
  assert.ok(fullResult.statistical_authority.validation_error_upper_bound_per_class[gt]<.10)
}

// Capture envelope is deliberately narrow and cannot be silently widened.
{
  const dataset=makeDataset()
  const artifact=artifactFor(dataset,{
    applicability_scope:{
      visibility:['visible','not_visible'],
      capture_types:['user_uploaded_single_image'],
      viewpoints:['drive_face_visible'],
      crop_types:['full_image'],
      resolution:{min_width_px:256,min_height_px:256,max_width_px:null,max_height_px:null},
      occlusion_conditions:['none'],glare_conditions:['none'],
    },
  })
  const validation=validationFor(dataset,artifact)
  const result=admission(dataset,artifact,validation)
  assert.equal(result.eligible_for_admission,false)
  assert.ok(result.reason_codes.includes('artifact_applicability_exceeds_policy'))
}

// Diagnostic Brier/log-loss/ECE are explicitly not production-v1 gates.
assert.equal(policy.metric_requirements.brier_score.required,false)
assert.equal(policy.metric_requirements.brier_score.threshold,null)
assert.equal(policy.metric_requirements.log_loss.required,false)
assert.equal(policy.metric_requirements.log_loss.threshold,null)
assert.equal(policy.metric_requirements.ece.required,false)
assert.equal(policy.metric_requirements.ece.threshold,null)

// Production state remains empty; active policy is admission authority only.
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,1)
assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY?.policy_version,'1.0.0')

console.log('Phase 2F.3 preregistered production policy regressions Q1-Q20 + S1-S7 passed')
console.log(JSON.stringify({
  policy_id:policy.policy_id,
  policy_version:policy.policy_version,
  policy_digest:policy.policy_content_digest_sha256,
  locked_at:policy.locked_at,
  required_classes:policy.minimum_support.required_classes,
  calibration_unique_specimens_per_class:policy.minimum_support.calibration_unique_specimens_per_class.minimum,
  validation_unique_specimens_per_class:policy.minimum_support.validation_unique_specimens_per_class.minimum,
  clopper_pearson:{zero_of_28:cp0of28,zero_of_29:cp0of29,one_of_29:cp1of29,one_of_50:cp1of50},
  production_state:{
    datasets:PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,
    artifacts:ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,
    semantic_registry:SEMANTIC_CALIBRATION_REGISTRY.length,
    policy_registry:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,
    active_policy:ACTIVE_SEMANTIC_CALIBRATION_POLICY?.policy_version??null,
  },
},null,2))
