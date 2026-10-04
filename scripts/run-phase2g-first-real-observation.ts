import { readFileSync,existsSync,writeFileSync,mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildCandidateBlindSemanticRequest } from '../lib/candidate-blind-semantic-request'
import { extractCandidateBlindSemanticEvidence } from '../lib/semantic-extractor'
import { PHASE2G_SENSOR_IDENTITY,validateObservationStart,digestObservationEvidence,type Phase2GObservationStart } from '../lib/semantic-calibration-phase2g-observation'

const startPath='data/semantic-calibration/observations/real-2026-001-start.json'
const evidencePath='data/semantic-calibration/observations/real-2026-001-observation.json'
if(existsSync(evidencePath)) throw new Error('first_real_observation_already_exists')
if(!existsSync(startPath)) throw new Error('observation_start_not_durable')
const start=JSON.parse(readFileSync(startPath,'utf8')) as Phase2GObservationStart
const sv=validateObservationStart(start); if(!sv.valid) throw new Error('observation_start_invalid:'+sv.reason_codes.join(','))
const bytes=readFileSync('data/semantic-calibration/candidates/real-2026-001/raw/real-2026-001-img-01.jpeg')
const sha=createHash('sha256').update(bytes).digest('hex')
if(bytes.length!==start.canonical_raw.byte_length||sha!==start.canonical_raw.sha256) throw new Error('canonical_raw_identity_mismatch')
const request=buildCandidateBlindSemanticRequest({image:bytes.toString('base64')})
if(request.image.image_sha256!==sha||request.semantic_roi.crop_ref!=='full_image_1') throw new Error('sensor_input_identity_mismatch')
const evidence=await extractCandidateBlindSemanticEvidence(request,'openai')
const source=evidence.evidence_sources[0]
if(!source||source.sensor_type!==PHASE2G_SENSOR_IDENTITY.sensor_type||source.model!==PHASE2G_SENSOR_IDENTITY.model||
 source.model_version!==PHASE2G_SENSOR_IDENTITY.model_version||source.prompt_version!==PHASE2G_SENSOR_IDENTITY.prompt_version||
 evidence.extractor_version!==PHASE2G_SENSOR_IDENTITY.extractor_version||evidence.taxonomy_version!==PHASE2G_SENSOR_IDENTITY.taxonomy_version){
 throw new Error('actual_sensor_identity_mismatch')
}
const body={
 schema_version:'hcsi.real-semantic-observation-evidence.v1' as const,observation_id:start.observation_id,specimen_id:start.specimen_id,image_id:start.image_id,
 dataset_id:start.dataset_id,dataset_version:start.dataset_version,split:start.split,started_at:start.started_at,completed_at:new Date().toISOString(),
 canonical_raw_sha256:sha,submitted_input_sha256:request.image.image_sha256,submitted_input_relation:'canonical_raw_exact_bytes' as const,
 sensor_identity:PHASE2G_SENSOR_IDENTITY,candidate_blind:true as const,ground_truth_in_sensor_input:false as const,evidence,
}
mkdirSync('data/semantic-calibration/observations',{recursive:true})
writeFileSync(evidencePath,JSON.stringify({...body,content_digest_sha256:digestObservationEvidence(body)},null,2)+'\n')
console.log('phase2g_real_observation_written')
