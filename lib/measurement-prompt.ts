import type { MeasurementResult } from '@/lib/measurement'

export function buildMeasurementEvidencePrompt(
  measurement: MeasurementResult | null,
  serviceErrorCode?: string | null
) {
  if (!measurement) {
    return `
===== HCSI 尺寸證據層 =====
本次 deterministic measurement service 沒有可用結果${serviceErrorCode ? `（${serviceErrorCode}）` : ''}。
你仍可根據外觀辨識五金種類與結構，但不得只靠照片中的 pixel 大小、視覺比例或主觀目測自行產生任何數值 mm / cm / inch 規格。
若尺寸是辨識精確規格的必要條件，請把該尺寸標為 unconfirmed，並明確說目前缺少可信尺度證據。
`
  }

  const measuredGeometrySteps = measurement.geometry_steps.filter((step) => step.status === 'measured')
  const unmeasuredGeometrySteps = measurement.geometry_steps.filter((step) => step.status !== 'measured')

  if (measurement.measurement_status === 'valid') {
    const evidence = {
      measurement_status: measurement.measurement_status,
      scale_system: measurement.scale_system,
      scale_source: measurement.ruler.scale_source,
      scale_px_per_cm: measurement.scale_px_per_cm,
      scale_px_per_inch: measurement.scale_px_per_inch,
      object_envelope_length_mm: measurement.length_mm,
      object_envelope_width_mm: measurement.width_mm,
      geometry_steps: measuredGeometrySteps,
      geometry_steps_not_measured: unmeasuredGeometrySteps,
      risk_signals: measurement.object.risk_signals,
      capture_assumptions: measurement.capture_assumptions,
    }
    return `
===== HCSI 尺寸證據層 =====
以下 JSON 是程式的 deterministic 尺度與幾何量測結果，不是 Vision LLM 的目測：
${JSON.stringify(evidence, null, 2)}

規則：
1. scale_system 可能是 metric / imperial / dual；所有 value_mm 與 object_envelope_*_mm 都已由 measurement service 統一換算成 mm。
2. object_envelope_length_mm / object_envelope_width_mm 只是整體 contour 的主軸包絡尺寸，不等於螺絲規格中的名義 L / D。只可做粗略外形範圍參考；若 geometry_steps 已提供對應語義尺寸，必須以 geometry_steps 為準。
3. geometry_steps 中 status=not_measured 的項目不是證據，不得補猜其數值。
4. axial_distance(object_tip,head_underface) 的 value_mm 是突出頭型螺絲的頭下長度 L；axial_distance(object_tip,head_top) 是沉頭／overall convention 的總長；axial_distance(object_tip,width_transition) 只代表指定 transition landmark 的軸向距離。outer_width(threaded_shank) 的 value_mm 是該螺紋桿身區域的實測外徑；periodicity(threaded_shank) 的 value_mm 是實測重複週期／螺距。
5. periodicity step 的 derived_tpi 若非 null，是 measurement service 依 TPI = 25.4 / pitch_mm deterministic 換算出的結果，可以視為與 pitch_mm 同一層級的實測衍生證據；不得自行改寫成其他牙數。
6. diagnostics 只用於解釋量測方法與排錯；它不是額外規格值。尤其 status=not_measured 時，即使 diagnostics 裡有局部估計，也不得當作正式尺寸答案。
7. 不可自行修改實測值、四捨五入成另一個標準規格後宣稱照片已證明該標準規格；完整標準規格仍需結合外觀與 reference / deterministic spec matcher 判斷。
8. 不可由這些量測值推導照片沒有實際量到的孔徑、牙型、強度等級或其他尺寸。
9. 若你在 specifications 引用量測值，label 請明確寫「系統實測…」，不要把它描述成 AI 目測。
`
  }

  const message = measurement.measurement_status === 'no_reference'
    ? '目前影像中沒有建立出可確認的尺度參考／尺制，因此本次只能進行 appearance-only identification。'
    : '目前影像雖有尺度／幾何線索，但 deterministic measurement preflight 判定不足以可靠輸出實際尺寸。'

  return `
===== HCSI 尺寸證據層 =====
${message}
measurement_status: ${measurement.measurement_status}
scale_system: ${measurement.scale_system}
reason_codes: ${measurement.reason_codes.join(', ') || 'none'}
geometry_steps: ${JSON.stringify(measurement.geometry_steps)}

你仍可辨識五金種類、結構與用途，但不得只靠照片中的 pixel 大小、視覺比例或主觀目測自行產生任何數值 mm / cm / inch 規格。
任何 status=not_measured 的 geometry step 都不得視為尺寸證據。對需要實際尺寸才能確認的精確規格，請標為 unconfirmed；不要把失敗量測的 diagnostics 當成尺寸證據。
`
}
