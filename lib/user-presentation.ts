import { CATEGORY_LABELS, type AnalysisResponse } from './identification'

type PublicGuidance=NonNullable<AnalysisResponse['user_guidance']>&{
 decision?:string
 requested_evidence?:{acquisition?:string}|null
 authoritative_purchase_decision_source?:string
 reason_codes?:string[]
}

export interface UserPresentation{
 item:string
 route:string
 purchase_phrase:string
 mode:'purchase_ready'|'targeted_followup'|'unresolved'
 action:string|null
 confirmations:string[]
 canonical_state:{
  purchase_ready:boolean
  selected_candidate_id:string|null
  decision:string
  requested_evidence:PublicGuidance['requested_evidence']
 }
}

function dedupeUncertainty(items:readonly string[]):string[]{
 const cleaned=[...new Set(items.map(x=>x.trim()).filter(Boolean))]
 const drive=cleaned.filter(x=>/驅動槽|槽型|drive/i.test(x))
 const nonDrive=cleaned.filter(x=>!drive.includes(x))
 if(drive.length){
  const actionable=drive.find(x=>/補拍|正面|確認/.test(x))??drive[0]
  nonDrive.push(actionable)
 }
 const score=(x:string)=>{
  if(/直徑/.test(x))return 1
  if(/螺距|牙距|TPI/i.test(x))return 2
  if(/總長|長度/.test(x))return 3
  if(/公制|英制|thread/i.test(x))return 4
  if(/驅動槽|槽型|drive/i.test(x))return 5
  if(/材質|鋼材|表面處理/.test(x))return 6
  if(/用途|自攻|木螺絲/.test(x))return 7
  return 20
 }
 return nonDrive.sort((a,b)=>score(a)-score(b)).slice(0,7)
}

/** Downstream-only renderer input. It never creates or changes purchase authority. */
export function buildUserPresentation(response:AnalysisResponse):UserPresentation{
 const g=(response.user_guidance??{purchase_ready:false,actions:[]}) as PublicGuidance
 const decision=g.decision??(g.purchase_ready?'purchase_ready':'unresolved')
 const requested=g.requested_evidence??null
 const targeted=decision==='targeted_followup_required'&&requested!==null
 const purchasePhrase=response.result.purchase_description
 const confirmations=targeted?[]:dedupeUncertainty(response.result.uncertain_fields)
 return {
  item:response.result.item_name,
  route:`${CATEGORY_LABELS[response.routing?.category??response.result.category]} → ${CATEGORY_LABELS[response.result.category]}`,
  purchase_phrase:purchasePhrase,
  mode:g.purchase_ready?'purchase_ready':targeted?'targeted_followup':'unresolved',
  action:targeted?(g.message||purchasePhrase):null,
  confirmations,
  canonical_state:{
   purchase_ready:g.purchase_ready,
   selected_candidate_id:g.selected_candidate_id??null,
   decision,
   requested_evidence:requested,
  },
 }
}
