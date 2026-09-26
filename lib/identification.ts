import { geometryCapabilityPromptReference, type GeometryCapabilityKind } from './geometry-capabilities'
import type { SemanticMeasurementPlan } from './measurement-plan-resolver'

export const HARDWARE_CATEGORIES = [
  'fasteners',
  'plumbing',
  'electrical',
  'building-hardware',
  'general-repair',
  'unknown',
] as const

export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number]
export type Provider = 'gemini' | 'openai' | 'grok'
export type EvidenceLevel = 'measured' | 'observed' | 'estimated' | 'unconfirmed'
export type HeadStyle = 'hex' | 'flat_countersunk' | 'pan' | 'truss' | 'button' | 'socket_cap' | 'round' | 'other' | 'unknown'

export interface SemanticVisionRegion {
  present: boolean
  confidence: number
  x_min: number
  y_min: number
  x_max: number
  y_max: number
}

export interface SemanticVisionContext {
  target_region: SemanticVisionRegion
  reference_region: SemanticVisionRegion
  head_style: HeadStyle
}

export interface CategoryRoutingResult {
  category: HardwareCategory
  object_hint: string
  reason: string
  semantic_vision: SemanticVisionContext
  measurement_plan: SemanticMeasurementPlan
}

export interface SpecificationItem {
  label: string
  value: string
  evidence_level: EvidenceLevel
}

export interface IdentificationResult {
  identification_status: 'identified' | 'partial' | 'unidentifiable'
  image_quality: 'good' | 'usable' | 'poor' | 'unusable'
  category: HardwareCategory
  item_name: string
  common_names: string[]
  subtype: string
  material: string
  visible_features: string[]
  specifications: SpecificationItem[]
  most_likely_identification: string
  confusable_candidate: string
  key_differentiator: string
  uncertain_fields: string[]
  typical_use: string
  purchase_description: string
  safety_note: string
  fastener_interpretation?: {
    head_style: HeadStyle
    drive_form: string
    thread_system: 'metric' | 'imperial' | 'unknown'
    length_convention: 'under_head' | 'overall' | 'unresolved'
    nominal_specification: string
  }
}

export interface AnalysisResponse {
  provider: Provider
  model: string
  routing?: CategoryRoutingResult
  result: IdentificationResult
}

export const CATEGORY_LABELS: Record<HardwareCategory, string> = {
  fasteners: '緊固／固定件',
  plumbing: '水管／管件',
  electrical: '電氣／配線',
  'building-hardware': '裝潢／建築五金',
  'general-repair': '通用維修件',
  unknown: '其他／不明',
}

const PLAN_STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operation: { type: 'string' },
    inputs: { type: 'array', items: { type: 'string' } },
    purpose: { type: 'string' },
  },
  required: ['operation', 'inputs', 'purpose'],
} as const

const SEMANTIC_REGION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    present: { type: 'boolean' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    x_min: { type: 'number', minimum: 0, maximum: 1000 },
    y_min: { type: 'number', minimum: 0, maximum: 1000 },
    x_max: { type: 'number', minimum: 0, maximum: 1000 },
    y_max: { type: 'number', minimum: 0, maximum: 1000 },
  },
  required: ['present', 'confidence', 'x_min', 'y_min', 'x_max', 'y_max'],
} as const

const PROPOSED_CONCEPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: ['landmark', 'region', 'operator', 'analyzer', 'unknown'] },
    purpose: { type: 'string' },
    why_existing_capabilities_are_insufficient: { type: 'string' },
  },
  required: ['name', 'kind', 'purpose', 'why_existing_capabilities_are_insufficient'],
} as const

export const ROUTING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: { type: 'string', enum: HARDWARE_CATEGORIES },
    object_hint: { type: 'string' },
    reason: { type: 'string' },
    semantic_vision: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target_region: SEMANTIC_REGION_SCHEMA,
        reference_region: SEMANTIC_REGION_SCHEMA,
        head_style: {
          type: 'string',
          enum: ['hex', 'flat_countersunk', 'pan', 'button', 'socket_cap', 'round', 'other', 'unknown'],
        },
      },
      required: ['target_region', 'reference_region', 'head_style'],
    },
    measurement_plan: {
      type: 'object',
      additionalProperties: false,
      properties: {
        minimum_sufficient_evidence: { type: 'string' },
        steps: { type: 'array', items: PLAN_STEP_SCHEMA },
        proposed_concepts: { type: 'array', items: PROPOSED_CONCEPT_SCHEMA },
      },
      required: ['minimum_sufficient_evidence', 'steps', 'proposed_concepts'],
    },
  },
  required: ['category', 'object_hint', 'reason', 'semantic_vision', 'measurement_plan'],
} as const

export const IDENTIFICATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    identification_status: { type: 'string', enum: ['identified', 'partial', 'unidentifiable'] },
    image_quality: { type: 'string', enum: ['good', 'usable', 'poor', 'unusable'] },
    category: { type: 'string', enum: HARDWARE_CATEGORIES },
    item_name: { type: 'string' },
    common_names: { type: 'array', items: { type: 'string' } },
    subtype: { type: 'string' }, material: { type: 'string' },
    visible_features: { type: 'array', items: { type: 'string' } },
    specifications: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, value: { type: 'string' }, evidence_level: { type: 'string', enum: ['measured', 'observed', 'estimated', 'unconfirmed'] } }, required: ['label', 'value', 'evidence_level'] } },
    most_likely_identification: { type: 'string' }, confusable_candidate: { type: 'string' }, key_differentiator: { type: 'string' },
    uncertain_fields: { type: 'array', items: { type: 'string' } }, typical_use: { type: 'string' }, purchase_description: { type: 'string' }, safety_note: { type: 'string' },
  },
  required: ['identification_status','image_quality','category','item_name','common_names','subtype','material','visible_features','specifications','most_likely_identification','confusable_candidate','key_differentiator','uncertain_fields','typical_use','purchase_description','safety_note'],
} as const

export function buildRoutingPrompt() {
  return `
你是 HCSI 第一階段的 Semantic Planner。先理解照片中的主要五金，再以第一性原則規劃「判定其採購／規格所需的最小充分物理證據」。

你不是量測器。禁止猜測或輸出任何 mm、cm、inch、TPI 等數值；只描述需要取得哪些幾何證據，以及如何由 geometry capability 組成。

category 從 fasteners、plumbing、electrical、building-hardware、general-repair、unknown 選一個。object_hint 用簡短繁體中文描述最可能的物件形態；不確定就明確表達不確定。

semantic_vision 是「語義空間先驗」，不是量測：
- target_region：主要五金在整張圖中的粗略 bounding box。
- reference_region：尺、捲尺或其他實際尺度參考物的粗略 bounding box；沒有就 present=false。
- 座標一律使用 0..1000 正規化座標，左上為 (0,0)、右下為 (1000,1000)。
- bounding box 要保守包住物件，不需要貼邊到像素級；後續 CV 會在這個 ROI 裡重新做 pixel ownership。
- confidence 是你對「這個框真的框到正確語義物件」的信心，不是尺寸信心。
- head_style 僅描述照片可見的頭型語義；不確定填 unknown。
- 絕對禁止由 bounding box 尺寸換算或猜測 mm / cm / inch；box 只用來告訴 CV「哪裡是目標、哪裡是尺度參考物」。

${geometryCapabilityPromptReference()}

measurement_plan 規則：
1. minimum_sufficient_evidence：說明要排除目前合理規格歧義，最少需要哪些物理證據。不要追求「能量的都量」。
2. steps：每一步包含 operation、inputs、purpose。operation/inputs 若與既有 vocabulary 語義相符，直接使用固定詞彙；可以自由組合既有能力。
3. 若規格判定確實需要現有 vocabulary 無法表達的幾何概念，可以直接在 step 使用新的清楚 snake_case 名稱，並同步加入 proposed_concepts。不要為符合 vocabulary 而硬套近似概念。
4. proposed_concepts 的 kind 為 landmark / region / operator / analyzer / unknown；必須說明 purpose，以及為什麼既有能力不足。若沒有新概念，輸出空陣列。
5. 每個 step 的 purpose 必須回答「這項證據能排除什麼規格歧義？」若不能回答，就不要加入該 step。
6. 不要把物件名稱或商品規格名稱當 geometry operation。Geometry plan 描述的是可由影像幾何執行器取得的證據。
7. 這是暫時語義規劃；後續 deterministic resolver 會自行判斷哪些 step 現在可執行，哪些只能保留為 proposed。你不需要假裝 Engine 會做所有事情。
8. fastener 的 L 量測 convention 不由你決定。若需要長度證據，可提出 axial_distance(object_tip, width_transition) 表達「需要軸向長度」；deterministic resolver 會依 semantic head_style 強制轉成 flat/countersunk 的 head_top→tip，或突出頭型的 head_underface→tip。
`
}

export function buildIdentificationPrompt(routing: CategoryRoutingResult, coreReference: string, categoryReference: string) {
  const plannedSteps = routing.measurement_plan.steps.map((step) => `${step.operation}(${step.inputs.join(', ')}) — ${step.purpose}`).join('\n') || '無'
  const proposed = routing.measurement_plan.proposed_concepts.map((concept) => concept.name).join(', ') || '無'
  return `
你是 HCSI 的第二階段「通用五金水電零件辨識器」。請分析目前使用者照片中的主要物件，並輸出符合指定 JSON schema 的繁體中文結果。

第一階段暫時路由：${routing.category}
第一階段物件提示：${routing.object_hint}
路由理由：${routing.reason}
語義頭型：${routing.semantic_vision.head_style}
最小充分物理證據：${routing.measurement_plan.minimum_sufficient_evidence}
規劃的 geometry steps：\n${plannedSteps}
Planner 提出的新 geometry concepts：${proposed}

第一階段規劃不是量測結果；最終辨識可依照片證據修正。不得把 proposed concept 當成已取得的 measured evidence。

===== HCSI 通用辨識原則 =====
${coreReference}

===== 本次類別的精簡參考資料 =====
${categoryReference}

===== 作答要求 =====
1. 最終判斷權在你。reference 只是辨識提示，不是規則引擎。
2. 先觀察，再推論；不要把常見規格當成照片已證明的規格。
3. 非尺寸屬性可以合理推論並標 estimated；任何數值尺寸不得靠 pixel 大小、視覺比例或主觀目測產生。沒有 HCSI deterministic measurement 時，數值尺寸必須標 unconfirmed。
4. 照片直接支持的資訊標 observed；HCSI deterministic measurement JSON 直接提供的尺寸才標 measured；無法確認標 unconfirmed。
5. 不可捏造看不到的品牌、型號、額定值、線徑、壓力等級或材質等級。
6. 若有合理最可能答案，明確選出；confusable_candidate 只放一個最容易混淆候選。
7. common_names 優先台灣 DIY、五金行或工地常見叫法。
8. purchase_description 是主要輸出：優先用台灣五金行常用名稱，結合原圖、成功實測 D／P／L、語義頭型與正確長度量法提出最可能的購買描述；標準公稱規格是 estimated，不能取代或改寫系統實測值。缺尺或某一步失敗時不得補猜 mm，購買描述僅包含有證據的規格並註明需確認；無合理公稱規格時只描述五金種類、已有實測及待確認事項。
9. typical_use 說明通常用途，不把照片施工情境當已知事實。
10. safety_note 僅在電氣、承重、壓力管路、燃氣、熱水、防水等風險時給必要提醒；一般低風險零件可說實際規格仍以實物量測或標示為準。
11. HCSI 採 one-shot identification；除非影像不可辨識，否則利用現有照片給最合理結論。
12. 影像不可用時 identification_status=unidentifiable、image_quality=unusable，並在 uncertain_fields 說明原因。
`
}

export function isHardwareCategory(value: unknown): value is HardwareCategory {
  return typeof value === 'string' && HARDWARE_CATEGORIES.includes(value as HardwareCategory)
}

const GEOMETRY_KINDS = ['landmark', 'region', 'operator', 'analyzer', 'unknown'] as const
function isGeometryKind(value: unknown): value is GeometryCapabilityKind | 'unknown' {
  return typeof value === 'string' && GEOMETRY_KINDS.includes(value as (typeof GEOMETRY_KINDS)[number])
}

function isPlanStep(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.operation === 'string' && Array.isArray(v.inputs) && v.inputs.every((x) => typeof x === 'string') && typeof v.purpose === 'string'
}

function isProposedConcept(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.name === 'string' && isGeometryKind(v.kind) && typeof v.purpose === 'string' && typeof v.why_existing_capabilities_are_insufficient === 'string'
}

export function isSemanticMeasurementPlan(value: unknown): value is SemanticMeasurementPlan {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.minimum_sufficient_evidence === 'string' && Array.isArray(v.steps) && v.steps.every(isPlanStep) && Array.isArray(v.proposed_concepts) && v.proposed_concepts.every(isProposedConcept)
}

function isSemanticVisionRegion(value: unknown): value is SemanticVisionRegion {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.present !== 'boolean' || typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)) return false
  if (v.confidence < 0 || v.confidence > 1) return false
  for (const key of ['x_min', 'y_min', 'x_max', 'y_max']) {
    const coordinate = v[key]
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1000) return false
  }
  if (v.present && ((v.x_max as number) <= (v.x_min as number) || (v.y_max as number) <= (v.y_min as number))) return false
  return true
}

function isSemanticVisionContext(value: unknown): value is SemanticVisionContext {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const headStyles: HeadStyle[] = ['hex', 'flat_countersunk', 'pan', 'button', 'socket_cap', 'round', 'other', 'unknown']
  return isSemanticVisionRegion(v.target_region) &&
    isSemanticVisionRegion(v.reference_region) &&
    typeof v.head_style === 'string' &&
    headStyles.includes(v.head_style as HeadStyle)
}

export function isRoutingResult(value: unknown): value is CategoryRoutingResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isHardwareCategory(v.category) &&
    typeof v.object_hint === 'string' &&
    typeof v.reason === 'string' &&
    isSemanticVisionContext(v.semantic_vision) &&
    isSemanticMeasurementPlan(v.measurement_plan)
}

export function isIdentificationResult(value: unknown): value is IdentificationResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return isHardwareCategory(v.category) && typeof v.item_name === 'string' && typeof v.most_likely_identification === 'string' && typeof v.purchase_description === 'string' && Array.isArray(v.common_names) && Array.isArray(v.visible_features) && Array.isArray(v.specifications) && Array.isArray(v.uncertain_fields)
}
