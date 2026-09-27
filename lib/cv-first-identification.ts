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

const LLM_DIMENSION_GUIDANCE = {
  D: { label: 'Thread major diameter', meaning: 'Outside diameter across the threaded shank; primary evidence for nominal screw diameter.' },
  P: { label: 'Thread pitch', meaning: 'Axial distance between adjacent thread repeats; primary evidence for metric pitch or imperial TPI.' },
  L_underhead: { label: 'Under-head length', meaning: 'Bearing/underface surface to physical tip; usually the purchase length for protruding-head screws.' },
  L_overall: { label: 'Overall length', meaning: 'Top of head to physical tip; usually the purchase length for countersunk/flat-head screws.' },
  K: { label: 'Head axial height', meaning: 'Axial height of the head; combine with the original image and DK to support head-style classification.' },
  DK: { label: 'Maximum head diameter', meaning: 'Maximum transverse head diameter/width; combine with the original image and K to support head-style classification.' },
} as const

function buildLlmReadableCvEvidence(measurement: MeasurementResult | null, measurementServiceError: string | null) {
  if (!measurement?.dimensions) return {
    source: 'deterministic_cv_before_llm',
    measurement_available: false,
    error: measurementServiceError || 'no_measurement_available',
    instruction: 'No trustworthy numeric CV evidence is available. Identify appearance only; do not invent precise dimensions.',
  }
  const dimensions = Object.fromEntries(
    (Object.keys(LLM_DIMENSION_GUIDANCE) as Array<keyof typeof LLM_DIMENSION_GUIDANCE>).map((key) => {
      const raw = measurement.dimensions?.[key]
      const guide = LLM_DIMENSION_GUIDANCE[key]
      return [key, {
        label: guide.label,
        meaning: guide.meaning,
        measured_mm: raw?.status === 'measured' ? raw.value_mm : null,
        measured_px: raw?.status === 'measured' ? raw.value_px : null,
        status: raw?.status ?? 'not_measured',
        confidence: raw?.confidence ?? 'not_measured',
        risks: raw?.risk_signals ?? [],
        failure_reasons: raw?.reason_codes ?? [],
        diagnostics: raw?.diagnostics ?? {},
      }]
    }),
  )
  return {
    source: 'deterministic_cv_before_llm',
    instruction: 'These are image measurements, not nominal catalogue dimensions. Preserve measured values exactly. Infer a likely purchasable nominal specification only as an inference.',
    measurement_status: measurement.measurement_status,
    measurement_confidence: measurement.measurement_confidence,
    scale_system: measurement.scale_system,
    dimensions,
    capture_conditions: {
      same_plane: measurement.capture_assumptions.same_plane_status,
      near_overhead: measurement.capture_assumptions.near_overhead_status,
    },
    global_risks: measurement.confidence_evaluation.reason_codes,
  }
}

export function buildCvFirstIdentificationPrompt(
  measurement: MeasurementResult | null,
  measurementServiceError: string | null,
  coreReference: string,
  fastenerReference: string
): string {
  const evidence = buildLlmReadableCvEvidence(measurement, measurementServiceError)
  return `你是 HCSI 台灣五金辨識器。你會同時看到原始照片，以及一份在你執行前由 deterministic CV 量出的尺寸證據。

主要任務：根據「照片外觀 + CV 實測證據」，回答這個五金最可能應該用什麼規格名稱去台灣五金行詢問／購買。你不是重做 CV，也不能覆寫 CV 原始值。

===== CV 尺寸證據（已翻成可直接理解的實體語義） =====
${JSON.stringify(evidence, null, 2)}

如何讀：
- measured_mm 是照片尺度換算出的實測毫米值，不是型錄公稱值。
- meaning 明確描述該尺寸量的是哪兩個實體位置及它對採購判斷的用途；按 meaning 理解，不要只靠縮寫猜。
- status=not_measured 表示沒有可靠數值；failure_reasons 是失敗原因，diagnostics 不能當替代尺寸。
- measured_with_risk 仍是 CV 實測，但帶有列出的風險；保留數值與風險，不要把它取消。
- D/P 是公稱直徑與牙距/牙數推論的主要數值證據。
- L_underhead/L_overall 是兩種不同 length convention；先從原圖判斷頭型，再選對應購買長度，禁止平均。
- K/DK 是頭型輔助證據；頭型仍需結合原圖形狀。
- 全牙／半牙與螺紋覆蓋型態由你直接觀察原圖判斷；CV 的 B 不參與本版語義辨識或購買規格推論。
- 原圖用來判斷 pan/truss/hex/flat-countersunk/socket-cap 等頭型，以及 Phillips/hex socket/Torx 等 drive form。
- 沒有外接標準尺寸資料表。可用一般工程知識提出最可能 nominal specification，但只能標 estimated。

===== 通用參考 =====
${coreReference}
===== 螺絲／五金參考 =====
${fastenerReference}

證據規則：
1. 傳入的 D、P、L_underhead、L_overall、K、DK 槽位互相獨立；任何成功實測不得因其他槽位失敗而被取消或改寫。
2. specifications：CV 原始值=measured；公稱規格推論=estimated；照片直接可見=observed；無依據=unconfirmed。
3. pan/truss/hex/button/socket_cap/round 通常採 L_underhead；flat_countersunk 通常採 L_overall。看不清頭型就 length_convention=unresolved。
4. head_style 與 drive_form 必須以原圖為主要形態證據，K/DK 只輔助；看不到 drive 就寫「待確認」。
5. thread_system 綜合原圖與 D/P 推定。P diagnostics 若含 derived_tpi，只視為 P 的 deterministic 衍生證據。
6. purchase_description 要能直接拿去台灣五金行詢問。證據足夠就給最可能完整規格；仍不確定的欄位明確標待確認，不為湊名稱亂猜。
7. 不可把 measured_mm 圓整成 nominal 後標 measured；measurement 與 inference 永遠分開。
8. S 驅動槽尺寸未實測且沒有驗證標準表；可辨識 drive form，但 S 尺寸維持 unconfirmed。T 不提供。
9. capture_conditions/global_risks 要反映在不確定性，但不能抹除成功實測。
10. 非螺絲物件要正確分類，不套用螺絲尺寸語義。
11. 必須輸出 fastener_interpretation 的 head_style、drive_form、thread_system、length_convention、nominal_specification；無法確認用 unknown/unresolved/空字串。
`
}
