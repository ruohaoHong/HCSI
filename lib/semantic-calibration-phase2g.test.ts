import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { PHASE2G_SENSOR_IDENTITY,validateObservationStart,validateObservationEvidence,assertPhase2GDoesNotAdmitCalibration,digestObservationEvidence,type Phase2GObservationStart } from './semantic-calibration-phase2g-observation'

const start:Phase2GObservationStart={
 schema_version:'hcsi.real-semantic-observation-start.v1',observation_id:'obs-test',specimen_id:'real-2026-001',image_id:'real-2026-001-img-01',
 dataset_id:'hcsi-real-semantic-candidate-2026-001',dataset_version:'1.0.0',split:'calibration',started_at:'2026-10-04T04:00:00Z',
 canonical_raw:{sha256:'b6c688ccf0cbed9ad3114e4075b4b3c1e72087d6d8c5007463756a1608dc7058',byte_length:49950,width_px:393,height_px:302,format:'JPEG'},
 sensor_identity:PHASE2G_SENSOR_IDENTITY,candidate_blind:true,ground_truth_in_sensor_input:false,standards_candidates_in_sensor_input:false,
}
assert.equal(validateObservationStart(start).valid,true)
for(const [field,value] of [['model','wrong'],['prompt_version','wrong'],['extractor_version','wrong'],['taxonomy_version','wrong']] as const){
 const bad=structuredClone(start) as any; bad.sensor_identity[field]=value; assert.equal(validateObservationStart(bad).valid,false)
}
const gtLeak=structuredClone(start); gtLeak.ground_truth_in_sensor_input=true as any; assert.equal(validateObservationStart(gtLeak).valid,false)
const wrongImage=structuredClone(start); wrongImage.canonical_raw.sha256='0'.repeat(64); assert.equal(validateObservationStart(wrongImage).valid,false)

const evidence:any={
 schema_version:'hcsi.real-semantic-observation-evidence.v1',observation_id:start.observation_id,specimen_id:start.specimen_id,image_id:start.image_id,
 dataset_id:start.dataset_id,dataset_version:start.dataset_version,split:'calibration',started_at:start.started_at,completed_at:'2026-10-04T04:01:00Z',
 canonical_raw_sha256:start.canonical_raw.sha256,submitted_input_sha256:start.canonical_raw.sha256,submitted_input_relation:'canonical_raw_exact_bytes',
 sensor_identity:PHASE2G_SENSOR_IDENTITY,candidate_blind:true,ground_truth_in_sensor_input:false,
 evidence:{observation_scope:{ground_truth_included:false,standards_candidates_included:false,image_sha256:start.canonical_raw.sha256}},
}
evidence.content_digest_sha256=digestObservationEvidence(evidence)
assert.equal(validateObservationEvidence(evidence,start).valid,true)
const rewrite=structuredClone(evidence); rewrite.evidence.observation_scope.image_sha256='1'.repeat(64); assert.equal(validateObservationEvidence(rewrite,start).valid,false)
const bundle=JSON.parse(readFileSync('data/semantic-calibration/manifests/real-2026-001-intake-bundle.json','utf8'))
const img=bundle.corpus_manifest.specimens[0].images[0]
assert.equal(bundle.acquisition_ledger.entries[0].semantic_sensor_observation_started_at,null)
assert.equal(img.viewpoint,'unknown'); assert.equal(img.visibility,'unknown'); assert.equal(img.occlusion_condition,'unknown'); assert.equal(img.glare_condition,'unknown')
assert.equal(bundle.corpus_manifest.specimens.length,1)
assertPhase2GDoesNotAdmitCalibration()
console.log('Phase 2G deterministic observation-boundary regressions passed')
