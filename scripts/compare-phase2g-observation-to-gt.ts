import { readFileSync,existsSync,writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const obsPath='data/semantic-calibration/observations/real-2026-001-observation.json'
const outPath='data/semantic-calibration/observations/real-2026-001-gt-comparison.json'
if(!existsSync(obsPath)) throw new Error('observation_not_persisted')
if(existsSync(outPath)) process.exit(0)
const obs=JSON.parse(readFileSync(obsPath,'utf8'))
const bundle=JSON.parse(readFileSync('data/semantic-calibration/manifests/real-2026-001-intake-bundle.json','utf8'))
const gt=bundle.corpus_manifest.specimens[0].ground_truth.find((x:any)=>x.feature_id==='drive.form')
const sensed=obs.evidence.observations.find((x:any)=>x.feature_id==='drive.form')
if(!gt||!sensed) throw new Error('comparison_inputs_missing')
const body={schema_version:'hcsi.real-semantic-observation-gt-comparison.v1',observation_id:obs.observation_id,compared_at:new Date().toISOString(),
 feature_id:'drive.form',sensor_value:sensed.value,ground_truth_value:gt.value,correct:sensed.value===gt.value,
 observation_content_digest_sha256:obs.content_digest_sha256,gt_source:gt.gt_source}
const digest=createHash('sha256').update(JSON.stringify(body)).digest('hex')
writeFileSync(outPath,JSON.stringify({...body,content_digest_sha256:digest},null,2)+'\n')
