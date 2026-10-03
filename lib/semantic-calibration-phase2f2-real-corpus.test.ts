import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  intakeRealSemanticCalibrationCorpus,
  type SemanticCalibrationRealCorpusIntakeBundleV1,
} from './semantic-calibration-corpus-files'
import {
  validateSemanticCalibrationAcquisitionLedger,
} from './semantic-calibration-acquisition-v1'
import { buildSemanticCalibrationCorpusCoverageReport } from './semantic-calibration-corpus-coverage'
import {
  ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,
  PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,
  SEMANTIC_CALIBRATION_REGISTRY,
} from './semantic-calibration-registry'
import {
  ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY,
} from './semantic-calibration-policy-v1'

const repoRoot=process.cwd()
const bundlePath=resolve(
  repoRoot,
  'data/semantic-calibration/manifests/real-2026-001-intake-bundle.json',
)
const imagePath=resolve(
  repoRoot,
  'data/semantic-calibration/candidates/real-2026-001/raw/real-2026-001-img-01.jpeg',
)

const bundle=JSON.parse(
  readFileSync(bundlePath,'utf8'),
) as SemanticCalibrationRealCorpusIntakeBundleV1

// Phase 2F.2 verifies the actual committed real material. It does not synthesize
// a specimen fixture and it does not invoke any semantic sensor.
const imageBytes=readFileSync(imagePath)
const actualSha=createHash('sha256').update(imageBytes).digest('hex')
assert.equal(imageBytes.length,49950)
assert.equal(
  actualSha,
  'b6c688ccf0cbed9ad3114e4075b4b3c1e72087d6d8c5007463756a1608dc7058',
)

assert.equal(bundle.acquisition_ledger.entries.length,1)
const acquisition=bundle.acquisition_ledger.entries[0]
assert.equal(acquisition.specimen_id,'real-2026-001')
assert.equal(acquisition.material_origin,'physical_specimen')
assert.equal(acquisition.physical_identity_verified,true)
assert.equal(acquisition.locked_split,'calibration')
assert.equal(acquisition.semantic_sensor_observation_started_at,null)

const ledgerValidation=validateSemanticCalibrationAcquisitionLedger(
  bundle.acquisition_ledger,
)
assert.equal(ledgerValidation.valid,true)
assert.deepEqual(ledgerValidation.reason_codes,[])

assert.deepEqual(bundle.corpus_manifest.feature_scope,['drive.form'])
assert.deepEqual(bundle.corpus_manifest.sensor_scope,['vlm'])
assert.equal(bundle.corpus_manifest.specimens.length,1)
assert.equal(bundle.corpus_manifest.specimens[0].images.length,1)
assert.equal(bundle.corpus_manifest.specimens[0].ground_truth.length,1)
const gt=bundle.corpus_manifest.specimens[0].ground_truth[0]
assert.equal(gt.feature_id,'drive.form')
assert.equal(gt.value,'hex_socket')
assert.equal(gt.self_labeled_by_sensor,false)
assert.equal(gt.verification_method,'user_provided_physical_specimen_claim')

const result=intakeRealSemanticCalibrationCorpus(bundle,repoRoot)
assert.equal(result.accepted,true)
assert.ok(result.dataset)
assert.deepEqual(result.reason_codes,[])
assert.equal(result.file_verification.length,1)
assert.equal(result.file_verification[0].verified,true)
assert.equal(result.file_verification[0].exists,true)
assert.equal(result.file_verification[0].sha256,actualSha)
assert.equal(result.file_verification[0].width_px,393)
assert.equal(result.file_verification[0].height_px,302)

const dataset=result.dataset
assert.equal(dataset.dataset_id,'hcsi-real-semantic-candidate-2026-001')
assert.equal(dataset.dataset_version,'1.0.0')
assert.equal(dataset.specimens.length,1)
assert.equal(dataset.specimens[0].images.length,1)
assert.equal(dataset.specimens[0].images[0].split,'calibration')

const coverage=buildSemanticCalibrationCorpusCoverageReport(dataset)
assert.equal(coverage.specimen_count,1)
assert.equal(coverage.image_count,1)
assert.equal(coverage.ground_truth_count,1)
assert.equal(coverage.per_feature_gt_class_counts['drive.form'].hex_socket,1)
assert.equal(coverage.per_split.calibration.specimen_count,1)
assert.equal(coverage.per_split.calibration.image_count,1)
assert.equal(
  coverage.semantics,
  'descriptive_inventory_only_not_production_sufficiency',
)

// Candidate acquisition is not production admission.
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,0)
assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY,null)

console.log('Phase 2F.2 first real independent candidate corpus intake passed')
console.log(JSON.stringify({
  specimen_id:acquisition.specimen_id,
  image_id:bundle.corpus_manifest.specimens[0].images[0].image_id,
  actual_image_bytes:imageBytes.length,
  actual_image_sha256:actualSha,
  accepted:result.accepted,
  dataset_id:dataset.dataset_id,
  dataset_version:dataset.dataset_version,
  dataset_content_digest_sha256:dataset.dataset_content_digest_sha256,
  file_verification:result.file_verification,
  coverage,
  semantic_sensor_observation_started_at:acquisition.semantic_sensor_observation_started_at,
  production_state:{
    production_datasets:PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,
    admitted_artifacts:ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,
    active_registry:SEMANTIC_CALIBRATION_REGISTRY.length,
    eligibility_policies:SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,
    active_policy:ACTIVE_SEMANTIC_CALIBRATION_POLICY,
  },
},null,2))
