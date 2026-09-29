import type { MeasurementResult } from '@/lib/measurement'
import { buildCvGroundingBasis } from '@/lib/cv-grounding-basis'
import { HEAD_STYLE_VALUES } from '@/lib/head-style-taxonomy'

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
        head_style: { type: 'string', enum: HEAD_STYLE_VALUES },
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
  const numbered = basis.unit_conversions.imperial_numbered_thread_math
  const groundedNumberedThread = numbered?.eligible_as_numbered_size_evidence
    ? `#${numbered.nearest_integer_size}-${numbered.nearest_integer_tpi}`
    : null
  const headNamingEvidence = {
    task: 'Name the external fastener head family from grounded engineering evidence.',
    thread_shank_context: {
      measured_D_mm: basis.hard_physical_facts.D_mm,
      measured_P_mm: basis.hard_physical_facts.P_mm,
      grounded_numbered_thread_candidate: groundedNumberedThread,
      note: groundedNumberedThread
        ? 'This numbered thread identity comes from reversible diameter/pitch arithmetic already validated against CV uncertainty.'
        : 'No nominal metric/inch name is injected here. Interpret D/P as size context using your existing fastener knowledge; do not invent a catalogue row.',
    },
    measured_head_envelope: {
      K_mm: basis.hard_physical_facts.K_mm,
      DK_mm: basis.hard_physical_facts.DK_mm,
    },
    geometry_family: basis.hard_physical_facts.head_geometry_class,
    drive_form_role: 'Use drive form only if actually visible in the original image. Do not infer drive from head dimensions.',
    secondary_visual_support: basis.evidence_partition.silhouette_integrity.can_constrain_head_subtype
      ? 'Original image and reliable silhouette may support or challenge the naming, but do not replace the D/P + K/DK + geometry-family engineering context.'
      : 'Silhouette is not reliable enough to constrain subtype; use only clearly visible original-image appearance as secondary support.',
    excluded_from_head_naming: [
      'purchase_length_dimension',
      'length_convention',
      'catalogue popularity',
      'case-specific thresholds',
    ],
  }

  return `你是 HCSI 的 CV-grounded 五金規格推論器。

最重要規則：先接受 deterministic CV 的物理事實，再看原始照片補足 CV 無法直接命名的語義。
不要先看照片猜一個商品，再拿 CV 去合理化它。

===== HEAD NAMING EVIDENCE（只用來命名 head_style，最高優先） =====
${JSON.stringify(headNamingEvidence, null, 2)}

對 head_style，先像工程師辨認螺絲一樣理解這一小包資料：
1. 先理解 D/P 所代表的 thread / shank 尺寸尺度；若已有 grounded_numbered_thread_candidate 就直接接受，沒有時不要硬套查表，只用你原本的五金知識理解尺寸上下文。
2. 在這個尺寸尺度下，同時看實測 K（頭高）與 DK（頭最大徑）。不要把 K、DK 當成孤立外觀數字；它們是 head family 的工程尺寸證據。
3. geometry_family 是 coarse physical fact，只限制沉頭/突出頭這種大類，不直接指定具體名稱。
4. drive_form 只有原圖真的看得到時才可輔助；看不到不能因此把可辨識的外部 head family 降成 other。
5. 原圖與可靠 silhouette 是 secondary support。它們用來確認外觀是否與上述工程證據一致，不要讓單一視覺印象蓋過 D/P + K/DK 的整體工程條件。
6. 不使用 length convention、purchase length、常見度或 case-specific threshold 來猜 head_style。
7. 這不是查表任務：不要因尺寸不熟悉或超出已見案例就輸出 other/unknown。只有現有工程證據與原圖真的不足以形成合理的標準 head-family 名稱時才保守輸出 unresolved 類別。

你要做的是：根據這組工程條件，用你既有的 fastener/domain knowledge 命名最合理的標準 external head family；不是從某一個比值觸發一個名稱。

===== STEP 0：完整物理推理基底（尺寸規格與交叉檢查） =====
${JSON.stringify(basis, null, 2)}
${serviceNote}

${basis.mode !== 'appearance_only'
  ? `hard_physical_facts 是本次規格推論的前提，不是建議：
1. nominal diameter：以 D_mm（必要時參考純換算 diameter_inch_decimal）作為唯一尺寸基準，照片不得改變 D。
   若 imperial_numbered_thread_math 存在，它只是把 Unified numbered-screw 的線性直徑關係反解成 size index，再顯示 nearest integer 與 diameter residual；不是 #size 查表。
   只有 eligible_as_numbered_size_evidence=true 時，才允許把 nearest_integer_size 當 numbered-screw 公稱直徑證據。這個布林值只表示「公式重建直徑殘差 ≤ CV 自己的直徑 uncertainty」。
   若 eligible_as_numbered_size_evidence=false，禁止使用 nearest_integer_size 把物件轉成 #size；這代表美制 numbered 直徑公式與實測 D 的差距已超出 CV 可解釋範圍。
2. nominal pitch/TPI：以 P_mm 與 pitch_tpi_exact 作為唯一尺寸基準，照片不得改變 P。
   只有 numbered diameter evidence 已成立時，imperial_numbered_thread_math.nearest_integer_tpi 與 pitch_difference_mm 才可用來形成 numbered-inch thread 的 TPI 候選。禁止只因 TPI 接近整數就把 metric thread 改成 imperial。
   禁止僅憑 TPI 自行加上 UNC/UNF 系列名稱。
3. nominal length：只使用 purchase_length_dimension 指定的 CV 長度。不得因某長度「比較常見」就選擇離 CV 更遠的候選。
   purchase_length_dyadic_approx 是同一個 CV 長度量化到最近 1/64 英寸後再約分；difference_mm 是量化殘差。
   當這個殘差相對實測長度很小時，可以把該分數當作「CV 長度的英制購買表示候選」；這不代表庫存保證，也不需要另外查一張長度規格表才能填 nominal_specification。
   不要把任意 decimal inch 四捨五入成商品尺寸；只能使用這個已提供 residual 的 dyadic quantization。
4. 頭型：fastener_interpretation.head_style 必須服從上方 HEAD NAMING EVIDENCE 的判斷。完整 cv_grounding_basis 中的 silhouette/profile 只做 secondary cross-check，不再作主要命名器。
   - 不使用 K/DK、DK/D 或任何單一 ratio 當 head-style lookup key。
   - 不從 length convention 反推頭型。
   - 不因 drive 看不到就把已由外部幾何與工程尺寸支持的 head family 填成 other。
   - head_style 只命名外部 head family；drive_form 是獨立觀測欄位。
5. 驅動槽：只有槽面真的看得到才判斷型式；看不到填「待確認」。禁止由頭型、K/DK 或未驗證標準知識猜驅動槽尺寸。
6. B 只有 optional_thread_extent 時才可當全牙/半牙輔助證據，且永遠不能覆寫 D/P/L。

最後才把上述結果組成台灣五金行可詢問的候選購買名稱。
CV mm 是 measured；公稱名稱/規格是 estimated。這裡的 nominal_specification 是「最吻合 CV 的採購候選」，不是庫存或標準文件認證。
${basis.mode === 'dimension_grounded_semantic_pending'
  ? '本次尺寸已由 CV／純數學 grounding 支持，但 detailed head silhouette 未通過完整性檢查。你仍應根據原圖做頭型語義判斷，且不得因 silhouette degraded 而重算或丟棄 D/P/L/K/DK；最終是否可直接購買由後端 final gate 決定。'
  : ''}
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
