import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { sha256Canonical } from './semantic-calibration-digest'
import { captureAuthorityDigest,type ProductionCaptureAuthorityV1,type FrozenObservationBinding,type RepositoryProvenanceProofV1 } from './semantic-calibration-phase2g1-production-envelope'

function git(args:string[],cwd:string){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}
function parseCommit(ref:string){const m=ref.match(/^git:\/\/commit\/([0-9a-f]{40})$/);if(!m)throw new Error('malformed_authority_commit_ref');return m[1]}
export function verifyProductionEnvelopeRepositoryProvenance(input:{repositoryRoot:string;expectedRepository:string;authority:ProductionCaptureAuthorityV1;authorityPath:string;observation:FrozenObservationBinding;observationPath:string}):RepositoryProvenanceProofV1{
 const {repositoryRoot,expectedRepository,authority,authorityPath,observation,observationPath}=input
 const authorityCommit=parseCommit(authority.acquisition_authority.ref)
 if(git(['rev-parse','--show-toplevel'],repositoryRoot)!==repositoryRoot)throw new Error('repository_root_mismatch')
 try{git(['cat-file','-e',authorityCommit+'^{commit}'],repositoryRoot)}catch{throw new Error('authority_commit_absent')}
 try{git(['cat-file','-e',observation.observation_commit_sha+'^{commit}'],repositoryRoot)}catch{throw new Error('observation_commit_absent')}
 let committedAuthority:string;try{committedAuthority=git(['show',authorityCommit+':'+authorityPath],repositoryRoot)}catch{throw new Error('authority_artifact_absent_at_commit')}
 let committedObservation:string;try{committedObservation=git(['show',observation.observation_commit_sha+':'+observationPath],repositoryRoot)}catch{throw new Error('observation_artifact_absent_at_commit')}
 let ca:any,co:any;try{ca=JSON.parse(committedAuthority)}catch{throw new Error('authority_artifact_invalid_json')}try{co=JSON.parse(committedObservation)}catch{throw new Error('observation_artifact_invalid_json')}
 if(sha256Canonical(ca)!==sha256Canonical(authority))throw new Error('authority_artifact_content_mismatch')
 if(captureAuthorityDigest(ca)!==authority.content_digest_sha256)throw new Error('authority_artifact_digest_mismatch')
 for(const k of ['specimen_id','image_id','feature_id'] as const)if(ca[k]!==authority[k])throw new Error('authority_'+k+'_mismatch')
 if(ca.raw?.sha256!==authority.raw.sha256)throw new Error('authority_raw_sha_mismatch')
 if(sha256Canonical(ca.policy_binding)!==sha256Canonical(authority.policy_binding))throw new Error('authority_policy_binding_mismatch')
 if(co.observation_id!==observation.observation_id||co.capture_authority_digest_sha256!==authority.content_digest_sha256||co.capture_authority_commit_sha!==authorityCommit)throw new Error('observation_artifact_binding_mismatch')
 if(authorityCommit===observation.observation_commit_sha)throw new Error('authority_and_observation_same_commit')
 try{git(['merge-base','--is-ancestor',authorityCommit,observation.observation_commit_sha],repositoryRoot)}catch{throw new Error('authority_not_ancestor_of_observation')}
 const blob=git(['rev-parse',authorityCommit+':'+authorityPath],repositoryRoot)
 return {schema_version:'hcsi.production-envelope-repository-proof.v1',repository:expectedRepository,authority_commit_sha:authorityCommit,authority_path:authorityPath,authority_blob_sha:blob,authority_content_digest_sha256:authority.content_digest_sha256,observation_commit_sha:observation.observation_commit_sha,observation_path:observationPath,authority_is_strict_ancestor_of_observation:true,verified:true}
}
