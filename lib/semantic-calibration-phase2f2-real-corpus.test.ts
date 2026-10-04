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
  semanticCalibrationDatasetContentDigest,
} from './semantic-calibration-dataset-v1'
import { readImageDimensionsFromBase64 } from './semantic-image-dimensions'
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
const manifestPath=resolve(
  repoRoot,
  'data/semantic-calibration/manifests/real-2026-001-manifest.json',
)
const rawAuthorityPath=resolve(
  repoRoot,
  'data/semantic-calibration/acquisition/real-2026-001-raw-authority.json',
)
const imagePath=resolve(
  repoRoot,
  'data/semantic-calibration/candidates/real-2026-001/raw/real-2026-001-img-01.jpeg',
)

const bundle=JSON.parse(
  readFileSync(bundlePath,'utf8'),
) as SemanticCalibrationRealCorpusIntakeBundleV1
const standaloneManifest=JSON.parse(readFileSync(manifestPath,'utf8'))
const rawAuthority=JSON.parse(readFileSync(rawAuthorityPath,'utf8')) as {
  specimen_id:string
  image_id:string
  canonical_selection_updated_by_user:boolean
  canonical_identity:{
    byte_length:number
    sha256:string
    width_px:number
    height_px:number
    format:string
  }
  raw_policy:{is_raw:boolean;derivative:boolean}
  disposition_of_existing_49950_byte_blob:string
}

// The standalone manifest and bundle-embedded manifest are one authority.
assert.deepEqual(bundle.corpus_manifest,standaloneManifest)

// Phase 2F.2.1 verifies metadata <-> actual committed bytes.
// It does not synthesize a specimen fixture and it does not invoke any semantic sensor.
const imageBytes=readFileSync(imagePath)
const actualSha=createHash('sha256').update(imageBytes).digest('hex')
const decoded=readImageDimensionsFromBase64(imageBytes.toString('base64'))
assert.ok(decoded)

assert.equal(rawAuthority.specimen_id,'real-2026-001')
assert.equal(rawAuthority.image_id,'real-2026-001-img-01')
assert.equal(rawAuthority.canonical_selection_updated_by_user,true)
assert.equal(rawAuthority.raw_policy.is_raw,true)
assert.equal(rawAuthority.raw_policy.derivative,false)
assert.equal(
  rawAuthority.disposition_of_existing_49950_byte_blob,
  'retained_as_canonical_raw',
)

// R1 — committed raw SHA equals canonical acquisition SHA.
assert.equal(actualSha,rawAuthority.canonical_identity.sha256)
assert.equal(
  actualSha,
  'b6c688ccf0cbed9ad3114e4075b4b3c1e72087d6d8c5007463756a1608dc7058',
)

// R2 — committed raw byte length equals canonical acquisition byte length.
assert.equal(imageBytes.length,rawAuthority.canonical_identity.byte_length)
assert.equal(imageBytes.length,49950)

// R3 — decoded dimensions equal canonical acquisition dimensions.
assert.equal(decoded.width_px,rawAuthority.canonical_identity.width_px)
assert.equal(decoded.height_px,rawAuthority.canonical_identity.height_px)
assert.equal(decoded.width_px,393)
assert.equal(decoded.height_px,302)
assert.equal(rawAuthority.canonical_identity.format,'JPEG')
assert.equal(imageBytes[0],0xff)
assert.equal(imageBytes[1],0xd8)
assert.equal(imageBytes[imageBytes.length-2],0xff)
assert.equal(imageBytes[imageBytes.length-1],0xd9)

const manifestImage=bundle.corpus_manifest.specimens[0].images[0]
assert.equal(manifestImage.image_id,rawAuthority.image_id)
assert.equal(manifestImage.sha256,actualSha)
assert.equal(manifestImage.width_px,decoded.width_px)
assert.equal(manifestImage.height_px,decoded.height_px)

assert.equal(bundle.acquisition_ledger.entries.length,1)
const acquisition=bundle.acquisition_ledger.entries[0]
assert.equal(acquisition.specimen_id,'real-2026-001')
assert.equal(acquisition.material_origin,'physical_specimen')
assert.equal(acquisition.physical_identity_verified,true)
assert.equal(acquisition.locked_split,'calibration')

// R6 — semantic observation remains unstarted.
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

// R4 — frozen intake recomputes the same SHA/dimensions from committed bytes.
const result=intakeRealSemanticCalibrationCorpus(bundle,repoRoot)
assert.equal(result.accepted,true)
assert.ok(result.dataset)
assert.deepEqual(result.reason_codes,[])
assert.equal(result.file_verification.length,1)
assert.equal(result.file_verification[0].verified,true)
assert.equal(result.file_verification[0].exists,true)
assert.equal(result.file_verification[0].sha256,actualSha)
assert.equal(result.file_verification[0].width_px,decoded.width_px)
assert.equal(result.file_verification[0].height_px,decoded.height_px)

const dataset=result.dataset
assert.equal(dataset.dataset_id,'hcsi-real-semantic-candidate-2026-001')
assert.equal(dataset.dataset_version,'1.0.0')
assert.equal(dataset.specimens.length,1)
assert.equal(dataset.specimens[0].images.length,1)
assert.equal(dataset.specimens[0].images[0].sha256,actualSha)
assert.equal(dataset.specimens[0].images[0].width_px,decoded.width_px)
assert.equal(dataset.specimens[0].images[0].height_px,decoded.height_px)
assert.equal(dataset.specimens[0].images[0].split,'calibration')

// R5 — dataset digest is recomputed from the final accepted dataset material.
assert.equal(
  semanticCalibrationDatasetContentDigest(dataset),
  dataset.dataset_content_digest_sha256,
)

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

// R7 — candidate acquisition remains outside production authority.
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0)
assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0)
assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0)
assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,1)
assert.equal(ACTIVE_SEMANTIC_CALIBRATION_POLICY?.status,'preregistered')

console.log('Phase 2F.2.1 original upload byte identity / raw provenance closure R1-R7 passed')
console.log(JSON.stringify({
  specimen_id:acquisition.specimen_id,
  image_id:manifestImage.image_id,
  canonical_raw:{
    byte_length:imageBytes.length,
    sha256:actualSha,
    width_px:decoded.width_px,
    height_px:decoded.height_px,
    format:rawAuthority.canonical_identity.format,
  },
  manifest_bundle_equal:true,
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
