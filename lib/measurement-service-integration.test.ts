import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MeasurementServiceError, runMeasurementPreflight } from './measurement-client'
import type { MeasurementResult, FixedDimension, CvDimensionEvidence } from './measurement'
import { toMeasurementV2 } from './measurement-v2'

const IMAGE_BYTES=Buffer.from('phase2l-deterministic-integration-probe')
const IMAGE_BASE64=IMAGE_BYTES.toString('base64')
const IMAGE_SHA=createHash('sha256').update(IMAGE_BYTES).digest('hex')
const FIXED:FixedDimension[]=['D','P','L_underhead','L_overall','B','K','DK']

function dim(value:number):CvDimensionEvidence{
 return {status:'measured',value_px:value*10,value_mm:value,confidence:'verified',risk_signals:[],reason_codes:[],diagnostics:{}}
}
function validMeasurement(sha=IMAGE_SHA):MeasurementResult{
 const dimensions:any={}
 for(const [i,key] of FIXED.entries())dimensions[key]=dim(i+1)
 return {
  schema_version:'hcsi.measurement.v1',
  image_sha256:sha,
  measurement_status:'valid',
  measurement_confidence:'verified',
  confidence_evaluation:{status:'verified',measurement_state:'measured',reason_codes:[],checks:[],recommendations:[],verified_for_purchase_spec:true},
  analysis_mode:'measurement_assisted',
  measurement_valid:true,
  retry_recommended:false,
  length_mm:10,
  width_mm:2,
  scale_system:'metric',
  scale_px_per_cm:100,
  scale_px_per_inch:254,
  geometry_steps:[],
  dimensions,
  head_geometry:null,
  image:{width_px:100,height_px:100},
  ruler:{detected:true,mark_count:5,scale_system:'metric',scale_source:'metric_ticks',scale_confidence:1,px_per_cm:100,px_per_inch:254,reference_interval_cm:1,median_px_per_cm:100,local_px_per_cm:100,perspective_ratio:1,perspective_step_pct:0,perspective_ok:true},
  object:{detected:true,contour_reliable:true,contour_area_px:100,contour_area_ratio:.1,solidity:1,principal_length_px:100,principal_width_px:20,min_area_length_px:100,min_area_width_px:20,principal_angle_deg:0,ruler_alignment_deg:0,segmentation_method:'fixture',risk_signals:[]},
  reason_codes:[],
  capture_assumptions:{same_plane_required:true,same_plane_verified:true,same_plane_status:'verified',near_overhead_required:true,near_overhead_status:'verified',ruler_parallel_required:false,ruler_parallel_preferred:true},
 }
}
async function expectCode(code:string,run:()=>Promise<unknown>){
 let thrown:unknown
 try{await run()}catch(e){thrown=e}
 assert.ok(thrown instanceof MeasurementServiceError)
 assert.equal(thrown.code,code)
}
async function main(){
 const old={url:process.env.HCSI_MEASUREMENT_SERVICE_URL,token:process.env.HCSI_MEASUREMENT_TOKEN,bypass:process.env.HCSI_MEASUREMENT_VERCEL_BYPASS}
 const oldFetch=globalThis.fetch
 try{
  // L1/L2 — configured endpoint + auth transport, valid service contract accepted.
  process.env.HCSI_MEASUREMENT_SERVICE_URL='https://measurement.example.test/base/'
  process.env.HCSI_MEASUREMENT_TOKEN='service-token'
  process.env.HCSI_MEASUREMENT_VERCEL_BYPASS='vercel-bypass'
  let seenUrl='',seenAuth='',seenBypass='',calls=0
  globalThis.fetch=(async(input:any,init:any)=>{
    calls++;seenUrl=String(input);const h=new Headers(init?.headers);seenAuth=h.get('authorization')??'';seenBypass=h.get('x-vercel-protection-bypass')??''
    return new Response(JSON.stringify(validMeasurement()),{status:200,headers:{'content-type':'application/json'}})
  }) as typeof fetch
  const accepted=await runMeasurementPreflight(IMAGE_BASE64)
  assert.equal(seenUrl,'https://measurement.example.test/base/measure')
  assert.equal(seenAuth,'Bearer service-token')
  assert.equal(seenBypass,'vercel-bypass')
  assert.equal(calls,1)
  assert.equal(accepted.image_sha256,IMAGE_SHA)

  // L3 — real service-shaped MeasurementResult feeds frozen MeasurementV2 unchanged.
  const v2=toMeasurementV2(accepted)
  assert.equal(v2.image_sha256,IMAGE_SHA)
  assert.equal(v2.observations.find(x=>x.quantity==='D')?.value_mm,1)
  assert.equal(v2.immutability.raw_measurements_are_nominally_snapped,false)

  // L4 — missing config fails before fetch; no fabricated measurements.
  delete process.env.HCSI_MEASUREMENT_SERVICE_URL
  let missingFetchCalls=0
  globalThis.fetch=(async()=>{missingFetchCalls++;throw new Error('must not fetch')}) as typeof fetch
  await expectCode('measurement_service_not_configured',()=>runMeasurementPreflight(IMAGE_BASE64))
  assert.equal(missingFetchCalls,0)

  // L5 — timeout remains infrastructure failure.
  process.env.HCSI_MEASUREMENT_SERVICE_URL='https://measurement.example.test'
  globalThis.fetch=(async()=>{const e=new Error('aborted');e.name='AbortError';throw e}) as typeof fetch
  await expectCode('measurement_timeout',()=>runMeasurementPreflight(IMAGE_BASE64))

  // L6 — malformed response is rejected, never accepted downstream.
  globalThis.fetch=(async()=>new Response(JSON.stringify({schema_version:'wrong'}),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch
  await expectCode('measurement_invalid_response',()=>runMeasurementPreflight(IMAGE_BASE64))

  // L7 — cross-image response is rejected by SHA binding.
  globalThis.fetch=(async()=>new Response(JSON.stringify(validMeasurement('b'.repeat(64))),{status:200,headers:{'content-type':'application/json'}})) as typeof fetch
  await expectCode('measurement_image_hash_mismatch',()=>runMeasurementPreflight(IMAGE_BASE64))

  // L8 — provider output cannot substitute for failed CV measurement.
  const runner=readFileSync('lib/provider-runner.ts','utf8')
  assert.match(runner,/const measurementV2 = measurement \? toMeasurementV2\(measurement\) : null/)
  assert.doesNotMatch(runner,/toMeasurementV2\((providerPayload|identificationRaw|llmNominalBeforeFinalGate)\)/)
  globalThis.fetch=(async()=>new Response('upstream down',{status:503})) as typeof fetch
  await expectCode('measurement_upstream_503',()=>runMeasurementPreflight(IMAGE_BASE64))

  console.log('Phase 2L measurement integration regressions L1-L8 passed')
 }finally{
  globalThis.fetch=oldFetch
  if(old.url===undefined)delete process.env.HCSI_MEASUREMENT_SERVICE_URL;else process.env.HCSI_MEASUREMENT_SERVICE_URL=old.url
  if(old.token===undefined)delete process.env.HCSI_MEASUREMENT_TOKEN;else process.env.HCSI_MEASUREMENT_TOKEN=old.token
  if(old.bypass===undefined)delete process.env.HCSI_MEASUREMENT_VERCEL_BYPASS;else process.env.HCSI_MEASUREMENT_VERCEL_BYPASS=old.bypass
 }
}
main()
