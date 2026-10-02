import { readFileSync,writeFileSync } from 'node:fs'
import { dirname,resolve } from 'node:path'
import {
  intakeRealSemanticCalibrationCorpus,
  type SemanticCalibrationRealCorpusIntakeBundleV1,
} from '../lib/semantic-calibration-corpus-files'
import { buildSemanticCalibrationCorpusCoverageReport } from '../lib/semantic-calibration-corpus-coverage'

function usage():never{
  console.error(
    'Usage: validate-semantic-calibration-corpus <intake-bundle.json> [base-dir] [coverage-output.json]'
  )
  process.exit(2)
}

const bundlePathArg=process.argv[2]
if(!bundlePathArg) usage()

const bundlePath=resolve(bundlePathArg)
const baseDir=resolve(process.argv[3]??dirname(bundlePath))
const coverageOutput=process.argv[4]?resolve(process.argv[4]):null

let bundle:SemanticCalibrationRealCorpusIntakeBundleV1
try{
  bundle=JSON.parse(readFileSync(bundlePath,'utf8')) as SemanticCalibrationRealCorpusIntakeBundleV1
}catch(error){
  console.error(JSON.stringify({
    accepted:false,
    reason_codes:['intake_bundle_unreadable'],
    detail:error instanceof Error?error.message:String(error),
  },null,2))
  process.exit(1)
}

const result=intakeRealSemanticCalibrationCorpus(bundle,baseDir)
if(!result.accepted||!result.dataset){
  console.error(JSON.stringify({
    accepted:false,
    reason_codes:result.reason_codes,
    file_verification:result.file_verification,
  },null,2))
  process.exit(1)
}

const coverage=buildSemanticCalibrationCorpusCoverageReport(result.dataset)
const output={
  accepted:true,
  dataset:{
    dataset_id:result.dataset.dataset_id,
    dataset_version:result.dataset.dataset_version,
    dataset_content_digest_sha256:result.dataset.dataset_content_digest_sha256,
  },
  file_verification:result.file_verification,
  coverage,
  production_admission_performed:false,
  calibration_fit_performed:false,
}
if(coverageOutput){
  writeFileSync(coverageOutput,JSON.stringify(coverage,null,2)+'\n','utf8')
}
console.log(JSON.stringify(output,null,2))
