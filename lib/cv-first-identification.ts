import type { MeasurementResult } from '@/lib/measurement'
import { buildCvGroundingBasis } from '@/lib/cv-grounding-basis'

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
    internal_nominal_mapping: {
      type: 'object', additionalProperties: false,
      properties: {
        nominal_diameter: {
          type: 'object', additionalProperties: false,
          properties: { label: { type: 'string' }, equivalent_mm: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
          required: ['label','equivalent_mm'],
        },
        nominal_pitch: {
          type: 'object', additionalProperties: false,
          properties: { label: { type: 'string' }, equivalent_mm: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
          required: ['label','equivalent_mm'],
        },
        nominal_length: {
          type: 'object', additionalProperties: false,
          properties: { label: { type: 'string' }, equivalent_mm: { anyOf: [{ type: 'number' }, { type: 'null' }] } },
          required: ['label','equivalent_mm'],
        },
      },
      required: ['nominal_diameter','nominal_pitch','nominal_length'],
    },
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
    'uncertain_fields','typical_use','purchase_description','safety_note','internal_nominal_mapping','fastener_interpretation'],
} as const

export function buildCvFirstIdentificationPrompt(
  measurement: MeasurementResult | null,
  measurementServiceError: string | null,
  coreReference: string,
  fastenerReference: string,
  allowPreciseSpec: boolean
): string {
  const basis = buildCvGroundingBasis(measurement, allowPreciseSpec)
  const serviceNote = measurement ? '' :
    `Measurement service unavailable: ${measurementServiceError ?? 'unknown'}.`

  return `你是 HCSI 的 CV-grounded 五金規格推論器。

最重要規則：先接受 deterministic CV 的物理事實，再看原始照片補足 CV 無法直接命名的語義。
不要先看照片猜一個商品，再拿 CV 去合理化它。

===== STEP 0：物理推理基底（最高優先級） =====
${JSON.stringify(basis, null, 2)}
${serviceNote}

${basis.mode === 'cv_grounded_specification'
  ? `hard_physical_facts 是本次規格推論的前提，不是建議：
1. nominal diameter：以 D_mm（必要時參考純換算 diameter_inch_decimal）作為唯一尺寸基準，使用你已有的工程／五金知識推論最符合的公稱牙徑。照片不得改變 D。
2. nominal pitch/TPI：以 P_mm 與純換算 pitch_tpi_exact 作為唯一尺寸基準，使用你已有的工程／五金知識推論最符合的公稱牙距／TPI。照片不得改變 P。
3. nominal length：只使用 purchase_length_dimension 指定的 CV 長度與純換算 purchase_length_inch_decimal，使用你已有的工程／五金知識推論最符合的公稱長度。不得因某長度「比較常見」就選擇離 CV 更遠的候選。
4. 頭型：先服從 head_geometry_class。countersunk 不可被原圖改成突出頭；protruding 時，原圖只能在相容的突出頭候選中細分。再使用 K_mm、DK_mm、head_support 與原圖判斷具體頭型。
5. 驅動槽：只有槽面真的看得到才判斷型式；看不到填「待確認」。禁止由頭型、K/DK 或未驗證標準知識猜驅動槽尺寸。
6. B 只有 optional_thread_extent 時才可當全牙/半牙輔助證據，且永遠不能覆寫 D/P/L。

最後才把上述結果組成台灣五金行可詢問的候選購買名稱。
CV mm 是 measured；公稱名稱/規格是 estimated。若找不到與 D/P/指定 L 同時相容的候選，nominal_specification 留空，不要硬湊。
你還必須填 internal_nominal_mapping（只供後端測試／驗證，前端不顯示）：
- nominal_diameter.label：你推論的公稱牙徑名稱；equivalent_mm：該公稱名稱本身代表的實際毫米等值。
- nominal_pitch.label：你推論的公稱牙距/TPI 名稱；equivalent_mm：該公稱牙距本身換算成毫米的等值。
- nominal_length.label：你推論的公稱長度名稱；equivalent_mm：該公稱長度本身換算成毫米的等值。
equivalent_mm 必須來自「候選公稱值本身」，禁止直接複製 CV measured_mm 來通過檢查。若你無法可靠提出某個候選，label 留空、equivalent_mm=null。
這個 internal_nominal_mapping 不要寫進 purchase_description、item_name、visible_features 或 specifications。
伺服器只會做一般數值一致性比較，不會提供 #號、M系列或英制分數候選表給你。`
  : `CV 必要證據不足。只辨識原圖中的五金種類與可見外觀；nominal_specification 必須為空字串，不得輸出精確 D/P/L 公稱規格。internal_nominal_mapping 的三個 label 必須留空，equivalent_mm 必須為 null。`}

===== 原始照片的角色（次於 CV 物理事實） =====
只用來補：具體頭型細分、可見的全牙/半牙、可見驅動槽型式、材質/表面與其他非尺寸外觀。
禁止從照片像素大小重新估 D/P/L/K/DK；禁止讓「看起來像某常見螺絲」凌駕更吻合的 CV 數值。

===== 通用參考 =====
${coreReference}
===== 螺絲／五金參考 =====
${fastenerReference}

輸出必須符合 schema。fastener_interpretation.nominal_specification 只能是與 CV grounding basis 相容的候選。
`
}
