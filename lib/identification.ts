export const HARDWARE_CATEGORIES = [
  'fasteners',
  'plumbing',
  'electrical',
  'building-hardware',
  'general-repair',
  'unknown',
] as const

export const MEASUREMENT_FAMILIES = [
  'threaded_bolt',
  'threaded_screw',
  'nut',
  'washer',
  'anchor',
  'pipe_fitting',
  'valve',
  'connector',
  'generic_object',
  'unknown',
] as const

export const MEASUREMENT_TARGETS = [
  'overall_length',
  'under_head_length',
  'major_diameter',
  'thread_pitch',
  'across_flats',
  'outer_diameter',
  'inner_diameter',
  'body_diameter',
  'branch_diameter',
] as const

export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number]
export type MeasurementFamily = (typeof MEASUREMENT_FAMILIES)[number]
export type MeasurementTarget = (typeof MEASUREMENT_TARGETS)[number]
export type Provider = 'gemini' | 'openai' | 'grok'
export type EvidenceLevel = 'measured' | 'observed' | 'estimated' | 'unconfirmed'

export interface MeasurementPlan {
  family: MeasurementFamily
  targets: MeasurementTarget[]
  reason: string
}

export interface CategoryRoutingResult {
  category: HardwareCategory
  object_hint: string
  reason: string
  measurement_plan: MeasurementPlan
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
}

export interface AnalysisResponse {
  provider: Provider
  model: string
  routing: CategoryRoutingResult
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

export const ROUTING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: {
      type: 'string',
      enum: HARDWARE_CATEGORIES,
    },
    object_hint: {
      type: 'string',
    },
    reason: {
      type: 'string',
    },
    measurement_plan: {
      type: 'object',
      additionalProperties: false,
      properties: {
        family: {
          type: 'string',
          enum: MEASUREMENT_FAMILIES,
        },
        targets: {
          type: 'array',
          items: {
            type: 'string',
            enum: MEASUREMENT_TARGETS,
          },
          uniqueItems: true,
        },
        reason: {
          type: 'string',
        },
      },
      required: ['family', 'targets', 'reason'],
    },
  },
  required: ['category', 'object_hint', 'reason', 'measurement_plan'],
} as const

export const IDENTIFICATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    identification_status: {
      type: 'string',
      enum: ['identified', 'partial', 'unidentifiable'],
    },
    image_quality: {
      type: 'string',
      enum: ['good', 'usable', 'poor', 'unusable'],
    },
    category: {
      type: 'string',
      enum: HARDWARE_CATEGORIES,
    },
    item_name: { type: 'string' },
    common_names: {
      type: 'array',
      items: { type: 'string' },
    },
    subtype: { type: 'string' },
    material: { type: 'string' },
    visible_features: {
      type: 'array',
      items: { type: 'string' },
    },
    specifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
          evidence_level: {
            type: 'string',
            enum: ['measured', 'observed', 'estimated', 'unconfirmed'],
          },
        },
        required: ['label', 'value', 'evidence_level'],
      },
    },
    most_likely_identification: { type: 'string' },
    confusable_candidate: { type: 'string' },
    key_differentiator: { type: 'string' },
    uncertain_fields: {
      type: 'array',
      items: { type: 'string' },
    },
    typical_use: { type: 'string' },
    purchase_description: { type: 'string' },
    safety_note: { type: 'string' },
  },
  required: [
    'identification_status',
    'image_quality',
    'category',
    'item_name',
    'common_names',
    'subtype',
    'material',
    'visible_features',
    'specifications',
    'most_likely_identification',
    'confusable_candidate',
    'key_differentiator',
    'uncertain_fields',
    'typical_use',
    'purchase_description',
    'safety_note',
  ],
} as const

export function buildRoutingPrompt() {
  return `
你是 HCSI 第一階段的「語義路由與量測規劃器」。你要根據目前照片中的主要物件，完成兩件事：
A. 做暫時的零件類別與物件形態判斷。
B. 告訴 deterministic geometry engine：如果之後有可靠尺度，這種物件最值得量哪些物理尺寸。

這一步絕對不要猜任何 mm、cm、inch、TPI 或其他數值規格；你只負責「理解物件」和「規劃應量什麼」。

category 從以下六類選一個：
- fasteners：螺絲、螺栓、螺帽、墊圈、鉚釘、壁虎、膨脹固定件、釘類等緊固／固定件。
- plumbing：水管、管件、接頭、閥、軟管、水龍頭相關零件、排水與密封管路零件。
- electrical：端子、接頭、配線固定、線路附件、電工管路與電氣安裝零件。
- building-hardware：鉸鏈、滑軌、角碼、支架、門窗／櫥櫃／木工與裝潢用五金。
- general-repair：O-ring、墊片、束環、彈簧、軸套、襯套、卡扣、一般機械維修小零件，或不適合前四類的常見維修件。
- unknown：照片無法看出主要物件，或物件明顯不屬於以上範圍。

measurement_plan.family 必須從以下選一個：
- threaded_bolt：有頭部與帶螺紋桿身的螺栓類；商品長度通常有「頭下長度」語義。
- threaded_screw：螺絲類，可能有尖端、沉頭或其他頭型。
- nut：螺帽／螺母類。
- washer：墊圈或平面環狀件。
- anchor：壁虎、膨脹螺栓、固定錨件等組合型固定件。
- pipe_fitting：水管／管路接頭與配件。
- valve：閥類。
- connector：電氣、管路或機械接頭，且不適合上面更明確的 family。
- generic_object：可辨識物件，但目前沒有專用量測 family。
- unknown：無法可靠判斷。

measurement_plan.targets 只能從以下選擇：
- overall_length：整體外形長度。
- under_head_length：從頭部底面到末端的有效長度。
- major_diameter：螺紋或圓柱桿身的外徑。
- thread_pitch：螺紋週期／牙距。
- across_flats：六角或多邊形件的對邊尺寸。
- outer_diameter：外圓直徑。
- inner_diameter：孔徑／內徑。
- body_diameter：主體直徑。
- branch_diameter：管件分支直徑。

規則：
1. object_hint 用簡短繁體中文描述照片中最可能的物件形態，例如「六角頭螺栓」；不確定時明確寫不確定。
2. measurement_plan 是量測意圖，不是量測結果。不得輸出任何數值。
3. 只選真正有助於辨識／採購規格的 targets，不要把所有項目都勾上。
4. 若是典型六角頭螺栓，優先考慮 threaded_bolt + under_head_length + major_diameter + thread_pitch；不要用 overall_length 取代商品規格中的頭下長度。
5. 如果照片不足以決定專用量測方法，family 用 generic_object 或 unknown；寧可保守，不要硬套。
6. 不要因為看到「有螺紋」就自動判成 fasteners；管件、閥、電工接頭也可能有螺紋。
7. reason 與 measurement_plan.reason 各寫一到兩句，說明主要可見依據與為什麼這些尺寸有意義。
8. 這仍是暫時規劃，第二階段最終辨識可以修正它。
`
}

export function buildIdentificationPrompt(
  routing: CategoryRoutingResult,
  coreReference: string,
  categoryReference: string
) {
  return `
你是 HCSI 的第二階段「通用五金水電零件辨識器」。請分析目前使用者照片中的主要物件，並輸出符合指定 JSON schema 的繁體中文結果。

第一階段暫時路由：${routing.category}
第一階段物件提示：${routing.object_hint}
路由理由：${routing.reason}
第一階段量測 family：${routing.measurement_plan.family}
第一階段預計量測項目：${routing.measurement_plan.targets.join(', ') || '無'}
量測規劃理由：${routing.measurement_plan.reason}

重要：第一階段路由與 measurement plan 都只是暫時語義規劃，不是最終答案，也不是量測結果。如果照片證據顯示它分錯類，你必須自行修正辨識，不可為了配合 reference 或第一階段計畫而硬套。

===== HCSI 通用辨識原則 =====
${coreReference}

===== 本次類別的精簡參考資料 =====
${categoryReference}

===== 作答要求 =====
1. 最終判斷權在你。reference 只是辨識提示，不是規則引擎，也不是待辨識物件。
2. 先觀察，再推論。不要把 reference 中的常見規格當成照片已證明的規格。
3. 非尺寸屬性可以做合理推論並標 estimated；但任何數值 mm / cm / inch 尺寸不得靠 pixel 大小、視覺比例或主觀目測產生。沒有 HCSI 尺寸證據層的 deterministic measurement 時，數值尺寸必須標 unconfirmed。
4. 只有照片能直接支持的資訊才標 observed；由 HCSI deterministic measurement JSON 直接提供的尺寸標 measured；無法確認的欄位標 unconfirmed，value 寫「照片無法確認」或具體說明缺少什麼證據。
5. 不可從單純 pixel 大小直接推出真實 mm / inch，也不可捏造看不到的品牌、型號、額定值、線徑、壓力等級或材質等級。
6. 若有一個合理的最可能答案，請明確選出，不要只列一串可能性。confusable_candidate 只放一個最容易混淆的候選；若沒有有意義的候選，寫「無明顯近似候選」。
7. common_names 優先提供台灣居家 DIY、五金行或工地可能使用的常見叫法；不確定的俗名不要硬編。
8. purchase_description 要寫成使用者去五金行／材料行時可直接描述的短句；對照片無法確認的關鍵規格，必須明確保留「需確認」而不是補猜。
9. typical_use 說明這個零件通常拿來做什麼，不要把照片中的實際施工情境當成已知事實。
10. safety_note 只在涉及電氣、承重、壓力管路、燃氣、熱水、防水等風險時給必要提醒；一般低風險零件可寫「一般辨識結果，實際規格仍以實物量測或標示為準」。
11. HCSI 採 one-shot identification。除非影像真的嚴重失焦、過暗、遮擋或主物件不可辨識，否則利用現有照片給出最合理結論，不要求補拍。
12. 若影像不可用，identification_status = unidentifiable、image_quality = unusable，並在 uncertain_fields 說明原因；其他字串欄位仍以簡短的「無法辨識」填滿以符合 schema。
`
}

export function isHardwareCategory(value: unknown): value is HardwareCategory {
  return typeof value === 'string' && HARDWARE_CATEGORIES.includes(value as HardwareCategory)
}

export function isMeasurementFamily(value: unknown): value is MeasurementFamily {
  return typeof value === 'string' && MEASUREMENT_FAMILIES.includes(value as MeasurementFamily)
}

export function isMeasurementTarget(value: unknown): value is MeasurementTarget {
  return typeof value === 'string' && MEASUREMENT_TARGETS.includes(value as MeasurementTarget)
}

export function isMeasurementPlan(value: unknown): value is MeasurementPlan {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    isMeasurementFamily(candidate.family) &&
    Array.isArray(candidate.targets) &&
    candidate.targets.every(isMeasurementTarget) &&
    typeof candidate.reason === 'string'
  )
}

export function isRoutingResult(value: unknown): value is CategoryRoutingResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    isHardwareCategory(candidate.category) &&
    typeof candidate.object_hint === 'string' &&
    typeof candidate.reason === 'string' &&
    isMeasurementPlan(candidate.measurement_plan)
  )
}

export function isIdentificationResult(value: unknown): value is IdentificationResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    isHardwareCategory(candidate.category) &&
    typeof candidate.item_name === 'string' &&
    typeof candidate.most_likely_identification === 'string' &&
    typeof candidate.purchase_description === 'string' &&
    Array.isArray(candidate.common_names) &&
    Array.isArray(candidate.visible_features) &&
    Array.isArray(candidate.specifications) &&
    Array.isArray(candidate.uncertain_fields)
  )
}
