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

export interface CategoryRoutingResult {
  category: HardwareCategory
  reason: string
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
    reason: {
      type: 'string',
    },
  },
  required: ['category', 'reason'],
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
你是 HCSI 的第一階段「零件類別路由器」。請只針對目前使用者照片中的主要物件分類，不要在這一步猜精確規格。

請從以下六類中選出一個最合適的 category：
- fasteners：螺絲、螺栓、螺帽、墊圈、鉚釘、壁虎、膨脹固定件、釘類等緊固／固定件。
- plumbing：水管、管件、接頭、閥、軟管、水龍頭相關零件、排水與密封管路零件。
- electrical：端子、接頭、配線固定、線路附件、電工管路與電氣安裝零件。
- building-hardware：鉸鏈、滑軌、角碼、支架、門窗／櫥櫃／木工與裝潢用五金。
- general-repair：O-ring、墊片、束環、彈簧、軸套、襯套、卡扣、一般機械維修小零件，或不適合前四類的常見維修件。
- unknown：照片無法看出主要物件，或物件明顯不屬於以上範圍。

規則：
1. 只根據照片中真正可見的形態與上下文分類。
2. 不要因為看到「有螺紋」就自動分類 fasteners；管件、閥、電工接頭也可能有螺紋。
3. reason 只寫一到兩句，指出最主要的可見分類依據。
4. 這個分類是暫時路由，不是最終辨識答案。
5. 使用繁體中文。
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
路由理由：${routing.reason}

重要：第一階段路由只是用來挑選參考資料，不是最終答案。如果照片證據顯示它分錯類，你必須自行改正 category，不可為了配合 reference 而硬套分類。

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

export function isRoutingResult(value: unknown): value is CategoryRoutingResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return isHardwareCategory(candidate.category) && typeof candidate.reason === 'string'
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
