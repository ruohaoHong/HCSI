import assert from 'node:assert/strict'
import type { AnalysisResponse } from './identification'
import { buildUserPresentation } from './user-presentation'

function fixture(overrides:Partial<AnalysisResponse>={}):AnalysisResponse{
 const base:AnalysisResponse={
  provider:'openai',
  model:'gpt-5.6-sol',
  result:{
   identification_status:'partial',
   image_quality:'usable',
   category:'fasteners',
   item_name:'沉頭尖尾全牙螺絲',
   common_names:[],
   subtype:'',
   material:'',
   visible_features:['internal-only-visible-feature'],
   specifications:[],
   most_likely_identification:'internal-most-likely',
   confusable_candidate:'internal-confusable',
   key_differentiator:'internal-differentiator',
   uncertain_fields:[
    '精確直徑','螺距','總長度','公制或英制',
    '驅動槽型與尺寸',
    '驅動槽型式及尺寸：目前角度無法確認，請補拍螺絲頭正面。',
    '鋼材等級','表面處理',
   ],
   typical_use:'internal-typical-use',
   purchase_description:'沉頭尖尾全牙螺絲（目前無法取得可信尺寸，因此不能安全判定購買規格。）',
   safety_note:'internal-safety-note',
   fastener_interpretation:{head_style:'flat_countersunk',drive_form:'待確認',thread_system:'unknown',length_convention:'overall',nominal_specification:''},
  },
  user_guidance:{
   purchase_ready:false,
   message:'目前無法取得可信尺寸，因此不能安全判定購買規格。',
   selected_candidate_id:null,
   standards_decision_status:'unavailable',
   actions:['依提示補拍'],
  },
 }
 return {...base,...overrides,result:{...base.result,...(overrides.result??{})},user_guidance:{...base.user_guidance,...(overrides.user_guidance??{})}}
}

const unresolved=fixture()
const p=buildUserPresentation(unresolved)
// L9 concise unresolved output — no raw diagnostics/provider model.
assert.equal(p.mode,'unresolved')
assert.equal(p.item,'沉頭尖尾全牙螺絲')
assert.match(p.purchase_phrase,/不能安全判定購買規格/)
const encoded=JSON.stringify({item:p.item,route:p.route,purchase_phrase:p.purchase_phrase,mode:p.mode,action:p.action,confirmations:p.confirmations})
for(const forbidden of ['gpt-5.6-sol','internal-only-visible-feature','internal-most-likely','internal-confusable','reason_codes','posterior_probability','candidate_id']){
 assert.equal(encoded.includes(forbidden),false)
}

// L10 presentation preserves, but does not mutate, canonical state.
assert.deepEqual(p.canonical_state,{purchase_ready:false,selected_candidate_id:null,decision:'unresolved',requested_evidence:null})
assert.equal(unresolved.user_guidance?.purchase_ready,false)

// L11 overlapping drive uncertainty appears once and keeps actionable wording.
const driveItems=p.confirmations.filter(x=>/驅動槽|槽型/.test(x))
assert.equal(driveItems.length,1)
assert.match(driveItems[0],/補拍螺絲頭正面/)

// L12 purchase-ready output is shortest and uses existing formal public phrase.
const ready=fixture({
 result:{...unresolved.result,purchase_description:'#4 × 1 in raised countersunk slotted stainless screw',uncertain_fields:['表面處理']},
 user_guidance:{...unresolved.user_guidance!,purchase_ready:true,selected_candidate_id:'formal-4x1',standards_decision_status:'selected',message:'',actions:[]},
})
;(ready.user_guidance as any).decision='purchase_ready'
const rp=buildUserPresentation(ready)
assert.equal(rp.mode,'purchase_ready')
assert.equal(rp.purchase_phrase,'#4 × 1 in raised countersunk slotted stainless screw')
assert.equal(rp.canonical_state.selected_candidate_id,'formal-4x1')

// L13 targeted follow-up makes the deterministic action primary.
const follow=fixture()
;(follow.user_guidance as any).decision='targeted_followup_required'
;(follow.user_guidance as any).requested_evidence={acquisition:'drive_face_view'}
follow.user_guidance!.message='請補拍螺絲頭正面，讓驅動槽完整入鏡。'
const fp=buildUserPresentation(follow)
assert.equal(fp.mode,'targeted_followup')
assert.equal(fp.action,'請補拍螺絲頭正面，讓驅動槽完整入鏡。')
assert.deepEqual(fp.confirmations,[])

console.log('Phase 2L user presentation regressions L9-L13 passed')
