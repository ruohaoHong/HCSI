import type { MeasurementResult } from '@/lib/measurement'

export const CV_FIRST_IDENTIFICATION_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    identification_status: { type: 'string', enum: ['identified', 'partial', 'unidentifiable'] },
    image_quality: { type: 'string', enum: ['good', 'usable', 'poor', 'unusable'] },
    category: { type: 'string', enum: ['fasteners', 'plumbing', 'electrical', 'building-hardware', 'general-repair', 'unknown'] },
    item_name: { type: 'string' }, common_names: { type: 'array', items: { type: 'string' } },
    subtype: { type: 'string' }, material: { type: 'string' },
    visible_features: { type: 'array', items: { type: 'string' } },
    specifications: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { label: { type: 'string' }, value: { type: 'string' },
        evidence_level: { type: 'string', enum: ['measured','observed','estimated','unconfirmed'] } },
      required: ['label','value','evidence_level'] } },
    most_likely_identification: { type: 'string' },
    confusable_candidate: { type: 'string' },
    key_differentiator: { type: 'string' },
    uncertain_fields: { type: 'array', items: { type: 'string' } },
    typical_use: { type: 'string' }, purchase_description: { type: 'string' }, safety_note: { type: 'string' },
    fastener_interpretation: {
      type: 'object', additionalProperties: false,
      properties: {
        head_style: { type: 'string', enum: ['hex','flat_countersunk','pan','truss','button','socket_cap','round','other','unknown'] },
        drive_form: { type: 'string' },
        thread_system: { type: 'string', enum: ['metric','imperial','unknown'] },
        length_convention: { type: 'string', enum: ['under_head','overall','unresolved'] },
        nominal_specification: { type: 'string' },
      },
      required: ['head_style','drive_form','thread_system','length_convention','nominal_specification'],
    },
  },
  required: ['identification_status','image_quality','category','item_name','common_names','subtype','material',
    'visible_features','specifications','most_likely_identification','confusable_candidate','key_differentiator',
    'uncertain_fields','typical_use','purchase_description','safety_note','fastener_interpretation'],
} as const

export function buildCvFirstIdentificationPrompt(
  measurement: MeasurementResult | null,
  measurementServiceError: string | null,
  coreReference: string,
  fastenerReference: string
): string {
  const evidence = measurement ? {
    source: 'CV executed BEFORE this LLM invocation; this is NOT an LLM plan',
    image_sha256: measurement.image_sha256,
    measurement_status: measurement.measurement_status,
    measurement_confidence: measurement.measurement_confidence,
    confidence_evaluation: measurement.confidence_evaluation,
    scale_system: measurement.scale_system,
    ruler: measurement.ruler,
    dimensions: measurement.dimensions ?? {},
    geometry_steps: measurement.geometry_steps,
    object: measurement.object,
    capture_assumptions: measurement.capture_assumptions,
    reason_codes: measurement.reason_codes,
  } : { measurement_service_error: measurementServiceError || 'no_measurement_available' }

  return `你是 HCSI 台灣五金辨識器。本次是嚴格 CV-first 流程：原圖與 CV 七個欄位（六項、L 兩候選）已先取得；
你沒有幾何規劃權，不能要求重跑 CV，也不可用目測、型錄公稱數字或自己的推理覆寫 CV 原始 px/mm。
請根據原圖與以下獨立 CV 證據，只做語義辨識、頭型、十字/內六角/Torx 等驅動形式、牙制、公稱規格推定與台灣五金行購買名稱。

===== 原始 CV 證據 =====
${JSON.stringify(evidence, null, 2)}

===== 通用參考 =====
${coreReference}
===== 螺絲／五金參考 =====
${fastenerReference}

嚴格證據規則：
1. dimensions.D、P、L_underhead、L_overall、B、K、DK 是獨立槽位。每個 status=measured 的原始值必須照實報告，任何另一項失敗、head_style=other/unknown 或 confidence=uncertain 不得將該成功槽位改成 not_measured。
2. status=not_measured 時 value_mm=null；diagnostics 中局部候選或物件整體長寬不可充當規格。no_reference 或 service error 時仍可做外觀辨識，禁止輸出未驗證精確尺寸。
3. 凸頭 pan/truss/hex/button/socket_cap/round 通常使用頭下 L_underhead；沉頭 flat_countersunk 使用 L_overall。當頭型或定義有疑義，length_convention=unresolved 並在 uncertain_fields 同時保留兩種候選和原因，禁止自行選一個。
4. fastener_interpretation.head_style 是你對原圖的最後判讀，可用 truss，不要把 truss 硬歸為 pan。drive_form 寫實際可見驅動槽，無法辨識時填「待確認」。
5. thread_system metric/imperial 只能綜合照片與成功實測的 D/P（含 derived_tpi）推定。nominal_specification 如有合理候選只標 estimated，絕不能在 specifications 把公稱 #10-32 或 M5 稱作實測。
6. specifications 中原始 CV 數字標 measured，推論公稱標 estimated，可見外觀標 observed，沒有依據標 unconfirmed；原始 CV 數字不許做公稱圓整。購買說法需將推定與待確認區分，優先台灣五金行用語。
7. S 驅動槽尺寸第一版不由照片直接量測，且本次沒有經驗證的標準尺寸查表。即使看出十字或 Torx，也要將 S 標 unconfirmed；不可以因公稱 D 猜測 S。T 不提供。
8. confidence_evaluation 與各 dimension risk_signals 為必須揭露之風險；共面、俯拍未知時不可宣稱已驗證，也不要因為全域風險取消各項已量到的數字。
9. 如果原圖不是螺絲，正確分類，但不可把不相干的 CV 螺絲尺寸套用到其他物件。
10. 請確實輸出 fastener_interpretation 的四種語義結論與 nominal_specification；無法確認時 unknown/unresolved/空字串。購買名稱不得偽裝成已確證之公稱規格。
`
}
