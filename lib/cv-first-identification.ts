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
1. nominal diameter：以 D_mm（必要時參考純換算 diameter_inch_decimal）作為唯一尺寸基準，照片不得改變 D。
   若 imperial_numbered_thread_math 存在，它只是把 Unified numbered-screw 的線性直徑關係反解成 size index，再顯示 nearest integer 與 diameter residual；不是 #size 查表。
   若 numbered_size_index_exact 很接近 nearest_integer_size，且 reconstructed_diameter 與 D 的 residual 很小，這是可用的算術證據，可由你轉譯為 numbered screw 的公稱直徑寫法；不要因沒有額外 catalog table 就把這個證據丟掉。
2. nominal pitch/TPI：以 P_mm 與 pitch_tpi_exact 作為唯一尺寸基準，照片不得改變 P。
   imperial_numbered_thread_math.nearest_integer_tpi 與 pitch_difference_mm 是純數學的最近整數 TPI 與重建誤差。若 residual 很小，可作為公稱 TPI 候選；但禁止僅憑 TPI 自行加上 UNC/UNF 系列名稱。
3. nominal length：只使用 purchase_length_dimension 指定的 CV 長度。不得因某長度「比較常見」就選擇離 CV 更遠的候選。
   purchase_length_dyadic_approx 是同一個 CV 長度量化到最近 1/64 英寸後再約分；difference_mm 是量化殘差。
   當這個殘差相對實測長度很小時，可以把該分數當作「CV 長度的英制購買表示候選」；這不代表庫存保證，也不需要另外查一張長度規格表才能填 nominal_specification。
   不要把任意 decimal inch 四捨五入成商品尺寸；只能使用這個已提供 residual 的 dyadic quantization。
4. 頭型：先服從 head_geometry_class。countersunk 不可被原圖改成突出頭；protruding 時，原圖只能在相容的突出頭候選中細分。
   具體頭型細分時，優先使用 head_shape_math 與 head_support 描述的「實測輪廓形狀」，再看照片語義：
   - K_over_DK、DK_over_D、top_over_underside_width、width_drop_underside_to_top 都是純算術比值；
   - lower_half_slope / upper_half_slope / slope_change 與 normalized_profile 描述頭部從 underside 到 top 的實際寬度變化；
   - 這些數值不是規格表、不是型號表，也不直接等於 pan/button/socket 等名稱。禁止套用「某數值=某頭型」的硬編碼表。
   - 你的任務是確認照片所選的語義名稱是否真的符合這組實測 silhouette；若某名稱所暗示的外形和 normalized_profile 明顯矛盾，就排除它，再從仍與實測輪廓一致的候選中命名。
   - 不得因「某頭型常見」或某尺寸常搭配某頭型而覆蓋實測輪廓。
5. 驅動槽：只有槽面真的看得到才判斷型式；看不到填「待確認」。禁止由頭型、K/DK 或未驗證標準知識猜驅動槽尺寸。
6. B 只有 optional_thread_extent 時才可當全牙/半牙輔助證據，且永遠不能覆寫 D/P/L。

最後才把上述結果組成台灣五金行可詢問的候選購買名稱。
CV mm 是 measured；公稱名稱/規格是 estimated。這裡的 nominal_specification 是「最吻合 CV 的採購候選」，不是庫存或標準文件認證。
如果 D/P/L 的純數學表示彼此一致、殘差很小，而且沒有物理矛盾，應組成候選 nominal_specification；不要只因未查 catalog table 就留空。
只有在 D/P/指定 L 之間彼此不相容、數學殘差明顯、或必要物理證據缺失時才留空。
不要另外輸出驗證用候選表或中間推理欄位；直接把最符合 CV 物理基底的公稱規格與使用者答案放進既有 schema。`
  : `CV 必要證據不足。只辨識原圖中的五金種類與可見外觀；nominal_specification 必須為空字串，不得輸出精確 D/P/L 公稱規格。`}

===== 原始照片的角色（次於 CV 物理事實） =====
只用來補：具體頭型細分、可見的全牙/半牙、可見驅動槽型式、材質/表面與其他非尺寸外觀。
禁止從照片像素大小重新估 D/P/L/K/DK；禁止讓「看起來像某常見螺絲」凌駕更吻合的 CV 數值。

===== 通用參考 =====
${coreReference}
===== 螺絲／五金參考 =====
${fastenerReference}

輸出必須符合 schema，而且內容應直接服務一般使用者。fastener_interpretation.nominal_specification 只能是與 CV grounding basis 相容的候選；不要把內部 CV JSON、reason code、validator 或推理步驟寫到使用者文字欄位。
`
}
