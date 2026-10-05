import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { PREREGISTERED_PRODUCTION_SEMANTIC_CALIBRATION_POLICY_V1 as policy,PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES,SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY } from './semantic-calibration-policy-v1'
import { PHASE2G_SENSOR_IDENTITY } from './semantic-calibration-phase2g-observation'
import { PRODUCTION_SEMANTIC_CALIBRATION_DATASETS,ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS,SEMANTIC_CALIBRATION_REGISTRY } from './semantic-calibration-registry'
import { finalizeCaptureAuthority,assessProductionEnvelopeEvidence,uniqueEligibleSpecimenCount,type ProductionCaptureAuthorityV1,type FrozenObservationBinding } from './semantic-calibration-phase2g1-production-envelope'

const sha='a'.repeat(64), commit='1'.repeat(40)
function authority(specimen='future-spec-001',image='future-img-001',split:'calibration'|'validation'='calibration'){
 return finalizeCaptureAuthority({schema_version:'hcsi.production-envelope-capture-authority.v1',authority_id:'auth-'+image,authority_version:'1.0.0',specimen_id:specimen,image_id:image,feature_id:'drive.form',split,acquired_at:'2026-10-05T01:00:00Z',established_at:'2026-10-05T01:01:00Z',acquisition_authority:{kind:'git_commit',ref:'git://commit/'+commit},source_scope:'independent_real_image',raw:{sha256:sha,byte_length:1000,width_px:512,height_px:512,format:'JPEG',source_ref:'raw://'+image},capture:{capture_type:'user_uploaded_single_image',crop_type:'full_image',viewpoint:'drive_face_visible',visibility:'visible',occlusion_condition:'none',glare_condition:'none'},policy_binding:{policy_id:policy.policy_id,policy_version:policy.policy_version,policy_content_digest_sha256:policy.policy_content_digest_sha256}})
}
function observation(a:ProductionCaptureAuthorityV1,id='obs-1'):FrozenObservationBinding{return {observation_id:id,specimen_id:a.specimen_id,image_id:a.image_id,feature_id:'drive.form',split:a.split,observed_at:'2026-10-05T01:02:00Z',image_sha256:a.raw.sha256,capture_authority_digest_sha256:a.content_digest_sha256,sensor_identity:{...PHASE2G_SENSOR_IDENTITY},original_observation:true}}
const good=authority(), obs=observation(good)
assert.equal(assessProductionEnvelopeEvidence(good,obs).eligible_to_count_as_calibration_evidence,true)
const bad=(mut:(x:any)=>void)=>{const x=JSON.parse(JSON.stringify(good));mut(x);return assessProductionEnvelopeEvidence(x,obs)}
for(const [mut,reason] of [
 [(x:any)=>{x.capture.viewpoint='unknown'},'viewpoint_out_of_policy'],
 [(x:any)=>{x.capture.visibility='unknown'},'visibility_out_of_policy'],
 [(x:any)=>{x.capture.occlusion_condition='partial'},'occlusion_out_of_policy'],
 [(x:any)=>{x.capture.glare_condition='present'},'glare_out_of_policy'],
 [(x:any)=>{x.raw.width_px=255},'width_below_policy_minimum'],
 [(x:any)=>{x.raw.height_px=255},'height_below_policy_minimum'],
 [(x:any)=>{x.capture.capture_type='other'},'capture_type_out_of_policy'],
 [(x:any)=>{x.capture.crop_type='crop'},'crop_type_out_of_policy'],
 [(x:any)=>{x.feature_id='head.profile'},'feature_mismatch'],
 [(x:any)=>{x.policy_binding.policy_content_digest_sha256='0'.repeat(64)},'policy_lineage_mismatch'],
] as Array<[(x:any)=>void,string]>){const r=bad(mut);assert.equal(r.eligible_to_count_as_calibration_evidence,false);assert.ok(r.reason_codes.includes(reason))}
const forbidden=JSON.parse(JSON.stringify(good));forbidden.source_scope='development_fixture';assert.ok(assessProductionEnvelopeEvidence(forbidden,obs).reason_codes.includes('non_real_source_forbidden'))
const missing=JSON.parse(JSON.stringify(good));missing.capture.viewpoint='';assert.ok(assessProductionEnvelopeEvidence(missing,obs).reason_codes.includes('viewpoint_missing'))
assert.equal(assessProductionEnvelopeEvidence(good,null).eligible_to_count_as_calibration_evidence,false)
const wrongSensor=observation(good);(wrongSensor.sensor_identity as any).model='other';assert.ok(assessProductionEnvelopeEvidence(good,wrongSensor).reason_codes.includes('sensor_identity_mismatch'))
const post=JSON.parse(JSON.stringify(good));post.capture.viewpoint='unknown';assert.ok(assessProductionEnvelopeEvidence(post,obs).reason_codes.includes('capture_authority_digest_mismatch'))
const replacement=observation(good);replacement.original_observation=false as true;assert.ok(assessProductionEnvelopeEvidence(good,replacement).reason_codes.includes('replacement_observation_forbidden'))
const repeated=Array.from({length:29},(_,i)=>{const a=authority('same-spec','img-'+i);return {authority:a,observation:observation(a,'obs-'+i)}})
assert.equal(uniqueEligibleSpecimenCount(repeated).unique_physical_specimen_count,1)
const multiObs=Array.from({length:29},(_,i)=>({authority:good,observation:observation(good,'obs-'+i)}))
assert.equal(uniqueEligibleSpecimenCount(multiObs).unique_physical_specimen_count,1)
const cross=[{authority:authority('cross','a','calibration'),observation:null},{authority:authority('cross','b','validation'),observation:null}]
assert.ok(uniqueEligibleSpecimenCount(cross).reason_codes.includes('physical_specimen_crosses_splits'))

const bundle=JSON.parse(readFileSync('data/semantic-calibration/manifests/real-2026-001-intake-bundle.json','utf8'))
const hi=bundle.corpus_manifest.specimens[0].images[0]
const historical=finalizeCaptureAuthority({schema_version:'hcsi.production-envelope-capture-authority.v1',authority_id:'historical-readonly-projection',authority_version:'1.0.0',specimen_id:'real-2026-001',image_id:'real-2026-001-img-01',feature_id:'drive.form',split:'calibration',acquired_at:bundle.acquisition_ledger.entries[0].acquired_at,established_at:bundle.acquisition_ledger.created_at,acquisition_authority:{kind:'git_commit',ref:'git://commit/'+commit},source_scope:'independent_real_image',raw:{sha256:hi.sha256,byte_length:49950,width_px:hi.width_px,height_px:hi.height_px,format:'JPEG',source_ref:hi.source_ref},capture:{capture_type:hi.capture_type,crop_type:hi.crop_type,viewpoint:hi.viewpoint,visibility:hi.visibility,occlusion_condition:hi.occlusion_condition,glare_condition:hi.glare_condition},policy_binding:{policy_id:policy.policy_id,policy_version:policy.policy_version,policy_content_digest_sha256:policy.policy_content_digest_sha256}})
const historicalResult=assessProductionEnvelopeEvidence(historical,null)
assert.equal(historicalResult.eligible_for_policy_envelope,false)
assert.ok(historicalResult.reason_codes.includes('viewpoint_out_of_policy')&&historicalResult.reason_codes.includes('visibility_out_of_policy'))
assert.equal(hi.viewpoint,'unknown');assert.equal(hi.visibility,'unknown');assert.equal(hi.occlusion_condition,'unknown');assert.equal(hi.glare_condition,'unknown')
const persisted=JSON.parse(readFileSync('data/semantic-calibration/observations/real-2026-001-observation.json','utf8'))
const comparison=JSON.parse(readFileSync('data/semantic-calibration/observations/real-2026-001-gt-comparison.json','utf8'))
assert.equal(persisted.content_digest_sha256,'cf8c2ff1c47d64297a48ee1ba363a350ffaa83091b383c7aee02a86ee73a66d1')
assert.equal(persisted.evidence.observations.find((x:any)=>x.feature_id==='drive.form').value,'not_visible')
assert.equal(comparison.observation_content_digest_sha256,persisted.content_digest_sha256);assert.equal(comparison.ground_truth_value,'hex_socket');assert.equal(comparison.correct,false)
assert.deepEqual(PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES,['phillips_like','pozidriv_like','slotted','hex_socket','torx_like','square_like','external_hex','combination'])
assert.equal(PRODUCTION_SEMANTIC_CALIBRATION_DATASETS.length,0);assert.equal(ADMITTED_SEMANTIC_CALIBRATION_ARTIFACTS.length,0);assert.equal(SEMANTIC_CALIBRATION_REGISTRY.length,0);assert.equal(SEMANTIC_CALIBRATION_ELIGIBILITY_POLICY_REGISTRY.length,1)
console.log('Phase 2G.1 production-envelope admission-boundary regressions A-X + positive control passed')
console.log(JSON.stringify({real_physical_specimens:1,real_images:1,semantic_observations:1,production_envelope_eligible_unique_specimens:0,eligible_support:Object.fromEntries(PRODUCTION_DRIVE_FORM_REQUIRED_CLASSES.map(c=>[c,0])),production_state:{datasets:0,artifacts:0,semantic_registry:0,policy_registry:1}},null,2))
