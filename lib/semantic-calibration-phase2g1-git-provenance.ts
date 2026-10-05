import { execFileSync } from 'node:child_process'
import { sha256Canonical } from './semantic-calibration-digest'
import { captureAuthorityDigest,assessProductionEnvelopeContent,type ProductionCaptureAuthorityV1,type FrozenObservationBinding,type RepositoryProvenanceProofV1 } from './semantic-calibration-phase2g1-production-envelope'

function git(args:string[],cwd:string){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
export function verifyProductionEnvelopeRepositoryProvenance(input:{repositoryRoot:string;authority:ProductionCaptureAuthorityV1;authorityPath:string;observation:FrozenObservationBinding;observationCommitSha:string;observationPath:string}):RepositoryProvenanceProofV1{
 const {repositoryRoot,authority,authorityPath,observation,observationCommitSha,observationPath}=input
 const authorityCommit=observation.capture_authority_commit_sha
 if(!/^[0-9a-f]{40}$/.test(authorityCommit))throw new Error('malformed_authority_commit_ref')
 if(git(['rev-parse','--show-toplevel'],repositoryRoot)!==repositoryRoot)throw new Error('repository_root_mismatch')
 let origin='';try{origin=git(['remote','get-url','origin'],repositoryRoot)}catch{throw new Error('repository_origin_missing')}
 if(!/(^|[:/])ruohaoHong\/HCSI(?:\.git)?$/.test(origin))throw new Error('repository_identity_mismatch')
 try{git(['cat-file','-e',authorityCommit+'^{commit}'],repositoryRoot)}catch{throw new Error('authority_commit_absent')}
 try{git(['cat-file','-e',observationCommitSha+'^{commit}'],repositoryRoot)}catch{throw new Error('observation_commit_absent')}
 let committedAuthority:string;try{committedAuthority=git(['show',authorityCommit+':'+authorityPath],repositoryRoot)}catch{throw new Error('authority_artifact_absent_at_commit')}
 let committedObservation:string;try{committedObservation=git(['show',observationCommitSha+':'+observationPath],repositoryRoot)}catch{throw new Error('observation_artifact_absent_at_commit')}
 let ca:any,co:any;try{ca=JSON.parse(committedAuthority)}catch{throw new Error('authority_artifact_invalid_json')}try{co=JSON.parse(committedObservation)}catch{throw new Error('observation_artifact_invalid_json')}
 for(const k of ['specimen_id','image_id','feature_id'] as const)if(ca[k]!==authority[k])throw new Error('authority_'+k+'_mismatch')
 if(ca.raw?.sha256!==authority.raw.sha256)throw new Error('authority_raw_sha_mismatch')
 if(sha256Canonical(ca.policy_binding)!==sha256Canonical(authority.policy_binding))throw new Error('authority_policy_binding_mismatch')
 if(captureAuthorityDigest(ca)!==authority.content_digest_sha256)throw new Error('authority_artifact_digest_mismatch')
 if(sha256Canonical(ca)!==sha256Canonical(authority))throw new Error('authority_artifact_content_mismatch')
 if(co.observation_id!==observation.observation_id||co.capture_authority_digest_sha256!==authority.content_digest_sha256||co.capture_authority_commit_sha!==authorityCommit)throw new Error('observation_artifact_binding_mismatch')
 if(authorityCommit===observationCommitSha)throw new Error('authority_and_observation_same_commit')
 try{git(['merge-base','--is-ancestor',authorityCommit,observationCommitSha],repositoryRoot)}catch{throw new Error('authority_not_ancestor_of_observation')}
 const blob=git(['rev-parse',authorityCommit+':'+authorityPath],repositoryRoot)
 return {schema_version:'hcsi.production-envelope-repository-proof.v1',repository:'ruohaoHong/HCSI',authority_commit_sha:authorityCommit,authority_path:authorityPath,authority_blob_sha:blob,authority_content_digest_sha256:authority.content_digest_sha256,observation_commit_sha:observationCommitSha,observation_path:observationPath,authority_is_strict_ancestor_of_observation:true,verified:true}
}

export interface ProductionRepositoryEvidenceInput {
 repositoryRoot:string; authority:ProductionCaptureAuthorityV1; authorityPath:string
 observation:FrozenObservationBinding; observationCommitSha:string; observationPath:string
}
/** Sole production-support transition: raw evidence -> live Git verification -> policy assessment -> specimen N.
 * No proof or assessment object is accepted as input, so caller-constructed records cannot increase N.
 */
export function countProductionEligibleSpecimensFromRepositoryEvidence(items:ProductionRepositoryEvidenceInput[]){
 const split=new Map<string,string>(),eligible=new Set<string>(),reason_codes:string[]=[]
 for(const item of items){
  const specimen=item.authority.specimen_id,prior=split.get(specimen)
  if(prior&&prior!==item.authority.split){reason_codes.push('physical_specimen_crosses_splits');continue}
  split.set(specimen,item.authority.split)
  const content=assessProductionEnvelopeContent(item.authority,item.observation)
  if(content.reason_codes.length){reason_codes.push(...content.reason_codes);continue}
  try{verifyProductionEnvelopeRepositoryProvenance(item);eligible.add(specimen)}
  catch(e){reason_codes.push(e instanceof Error?e.message:'repository_provenance_verification_failed')}
 }
 return {unique_physical_specimen_count:eligible.size,reason_codes:[...new Set(reason_codes)]}
}
