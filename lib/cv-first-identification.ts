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

// Keep debug diagnostics and raw pixel tracks on the server. The model needs
// physical meaning, trusted millimetres and any observable limitations.
function buildLlmReadableCvEvidence(measurement: MeasurementResult | null, measurementServiceError: string | null) {
  if (!measurement?.dimensions) return {
    source: 'deterministic_cv_before_llm',
    measurement_available: false,
    note: 'No trustworthy numeric measurements are available; classify visible appearance only.',
    service_unavailable: Boolean(measurementServiceError),
  }
  const readable = Object.fromEntries(
    (Object.keys(LLM_DIMENSION_GUIDANCE) as Array<keyof typeof LLM_DIMENSION_GUIDANCE>).map(key => {
      const raw = measurement.dimensions?.[key]
      const guide = LLM_DIMENSION_GUIDANCE[key]
      return [key, {
        label: guide.label,
        physical_meaning: guide.meaning,
        measured_mm: raw?.status === 'measured' ? raw.value_mm : null,
        status: raw?.status ?? 'not_measured',
        reliability: raw?.confidence ?? 'not_measured',
        observable_limitations: (raw?.risk_signals ?? []).filter(reason =>
          !['same_plane_unverified', 'capture_orientation_unverified',
            'object_ruler_alignment_unknown'].includes(reason)
        ).map(reason => ({
          perspective_risk_detected: 'Ruler perspective variation exceeds the trusted capture range.',
          scale_observation_support_insufficient: 'Too few independent ruler ticks to trust the scale.',
          segmentation_risk_detected: 'Hardware/ruler boundary separation is unreliable.',
          thread_boundary_resolution_limited_by_visible_pitch: 'Thread end is only resolved to about one pitch.',
          same_plane_rejected: 'Hardware and ruler were confirmed not to be coplanar.',
          capture_orientation_rejected: 'Capture angle was confirmed unsuitable for the measurement.',
        } as Record<string, string>)[reason] ?? 'An additional CV-observed reliability limit is recorded internally'),
      }]
    })
  )
  const pitch = measurement.dimensions.P
  const pitchStep = measurement.geometry_steps.find(step =>
    step.operation === 'periodicity' && step.status === 'measured' &&
    step.inputs.length === 1 && step.inputs[0] === 'threaded_shank'
  )
  const tpi = pitch?.status === 'measured' && pitch.value_mm && pitch.value_mm > 0
    ? pitchStep?.derived_tpi ?? Number((25.4 / pitch.value_mm).toFixed(2))
    : null
  if (tpi !== null) Object.assign(readable.P, { derived_tpi_from_measured_pitch: tpi })
  const B = measurement.dimensions.B
  const bScaleChecks = ['scale_available', 'scale_observation_support',
    'perspective_risk', 'object_geometry', 'segmentation_risk'].every(id =>
    measurement.confidence_evaluation.checks.some(check => check.id === id && check.status === 'passed')
  )
  const bObservedRisks = B?.risk_signals.filter(reason =>
    !['same_plane_unverified', 'capture_orientation_unverified',
      'object_ruler_alignment_unknown', 'thread_boundary_resolution_limited_by_visible_pitch'].includes(reason)
  ) ?? []
  const optional_thread_extent = B?.status === 'measured' && B.value_mm !== null &&
    Number.isFinite(B.value_mm) && B.value_mm > 0 && bScaleChecks && bObservedRisks.length === 0
    ? {
        measured_mm: B.value_mm,
        label: 'Visible threaded extent: optional support for thread coverage, not a standard thread length',
        limitation: 'Thread termination is resolved only to roughly one visible pitch; use as auxiliary evidence, never override D/P/L.',
      }
    : null
  const K = measurement.dimensions.K
  const DK = measurement.dimensions.DK
  const D = measurement.dimensions.D
  const headProportions = K?.status === 'measured' && DK?.status === 'measured' &&
    K.value_mm && DK.value_mm && DK.value_mm > 0
    ? {
        height_to_head_width: Number((K.value_mm / DK.value_mm).toFixed(3)),
        head_width_to_shank_diameter: D?.status === 'measured' && D.value_mm && D.value_mm > 0
          ? Number((DK.value_mm / D.value_mm).toFixed(3)) : null,
        note: 'Physical constraints, not a unique head-style classifier.',
      } : null
  const head = measurement.head_geometry
  const headGeometry = head?.status === 'measured' ? {
    quality: head.quality,
    silhouette_class: head.length_convention_evidence,
    silhouette_meaning: head.length_convention_evidence === 'countersunk'
      ? 'Head widens from the shank toward its outer top: countersunk-type physical geometry.'
      : head.length_convention_evidence === 'protruding'
        ? 'Head has a wide underside: protruding-head geometry; this alone cannot distinguish pan/button/truss/hex.'
        : 'The side silhouette alone cannot establish the head length convention.',
    height_to_width_ratio: head.height_to_width,
    underside_width_ratio: head.bearing_width_ratio,
    top_width_ratio: head.top_width_ratio,
    shape_limitation: head.quality === 'reliable'
      ? 'Physical constraint on the possible head types, not a unique catalogue-standard match.'
      : 'Head silhouette is degraded; do not force a head type or a purchasable nominal specification.',
  } : {
    quality: 'unavailable',
    silhouette_meaning: 'No reliable head silhouette was measured.',
  }
  return {
    source: 'deterministic_cv_before_llm',
    scale_system: measurement.scale_system,
    physical_dimensions: readable,
    optional_thread_extent,
    head_proportions: headProportions,
    head_geometry: headGeometry,
    capture_caution: 'A single image cannot independently prove the hardware and ruler are coplanar.',
  }
}

export function buildCvFirstIdentificationPrompt(
  measurement: MeasurementResult | null,
  measurementServiceError: string | null,
  coreReference: string,
  fastenerReference: string,
  allowPreciseSpec: boolean
): string {
  const evidence = buildLlmReadableCvEvidence(measurement, measurementServiceError)
  return `你是 HCSI 台灣五金辨識器。你會同時看到原始照片，以及事先由 deterministic CV 取得的物理尺寸證據。
任務：整合原圖與 CV 物理證據，辨識五金與適用的台灣五金行購買名稱。不得改寫 CV 原始測量值。

推論模式：${allowPreciseSpec
  ? '必要 CV 前置品質檢查已通過。你可以推論候選公稱規格，但結果還會再經過頭型與正確長度的最終核驗。'
  : '必要 CV 品質或尺寸不足。只辨識原圖外觀，不提供任何完整或精確的公稱購買規格；nominal_specification 必須為空字串。'}

===== 具物理語義的 CV 證據 =====
${JSON.stringify(evidence, null, 2)}

讀取與推論原則：
- measured_mm 是實際影像測量的毫米值，不是公稱型錄值。公稱規格只能標 estimated。
- D 螺紋外徑、P 螺距、對應頭型的正確 L 為核心採購證據。P 的 derived_tpi_from_measured_pitch 是衍生證據。
- K 頭高、DK 頭寬、比例和可用頭部輪廓是物理約束。可信 CV 沉頭/突出頭證據優先於主觀目測；當側面幾何只支持突出頭大類時，仍須依原圖判別 pan/button/truss 等細分頭型，不能僅憑 K/DK 強行指定。
- pan/truss/hex/button/socket_cap/round 通常使用 L_underhead；flat_countersunk 通常使用 L_overall。禁止平均或改寫兩種實測值；頭型仍不明就 unresolved。
- optional_thread_extent 若有可信實測，只當全牙/半牙輔助證據；沒有 B 不等於其他尺寸失敗。視覺上可自行觀察螺紋覆蓋範圍。
- 實際拍攝常只有側視圖。只有槽面清楚可見，或有其他已驗證證據時，才指定驅動槽型式；看不到填「待確認」。目前沒有驅動槽 S 尺寸的實測與可信標準表，禁止從 K/DK、螺絲名稱猜 S 號數。需確認時請補拍頭部正面。
- reliability 的 measured_with_risk 表示有具體量測限制；不要把風險當作尺寸，也不要把失敗槽位的診斷當成測量。
- CV measured、原圖 observed、推論公稱 estimated、缺乏證據 unconfirmed，四者不得混淆。
- 本版不提供 T，也沒有外接標準尺寸表。非螺絲物件要按原圖正確分類，不套用螺絲量法。

===== 通用參考 =====
${coreReference}
===== 螺絲／五金參考 =====
${fastenerReference}

輸出必須符合 schema，包括 fastener_interpretation 的 head_style、drive_form、thread_system、length_convention、nominal_specification。
`
}
