import { NextResponse } from 'next/server'
import { runMeasurementPreflight, MeasurementServiceError } from '@/lib/measurement-client'
import { toMeasurementV2 } from '@/lib/measurement-v2'
import { buildStandardsAuthorityResult } from '@/lib/standards-shadow-solver'
import { STANDARDS_CATALOGUE_V1 } from '@/lib/standards-database-v1'

export const runtime='nodejs'

const PROBE_IMAGE='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6rQAAAAASUVORK5CYII='
const FIXED=['D','P','L_underhead','L_overall','B','K','DK'] as const

export async function GET(request:Request){
 const token=new URL(request.url).searchParams.get('token')
 if(!process.env.PHASE2L_PROBE_TOKEN||token!==process.env.PHASE2L_PROBE_TOKEN){
  return NextResponse.json({error:'not_found'},{status:404})
 }
 try{
  const measurement=await runMeasurementPreflight(PROBE_IMAGE)
  const v2=toMeasurementV2(measurement)
  const standards=buildStandardsAuthorityResult(v2,STANDARDS_CATALOGUE_V1)
  return NextResponse.json({
   ok:true,
   measurement_schema:measurement.schema_version,
   measurement_status:measurement.measurement_status,
   measurement_valid:measurement.measurement_valid,
   fixed_dimension_slots_present:FIXED.every(key=>measurement.dimensions?.[key]!==undefined),
   image_sha256:measurement.image_sha256,
   measurement_v2_schema:v2.schema_version,
   standards_authority_mode:standards.mode,
   standards_candidate_count:standards.formal_candidates.length,
  })
 }catch(error){
  if(error instanceof MeasurementServiceError){
   return NextResponse.json({ok:false,code:error.code,message:error.message},{status:503})
  }
  return NextResponse.json({ok:false,code:'unexpected_probe_error'},{status:502})
 }
}
