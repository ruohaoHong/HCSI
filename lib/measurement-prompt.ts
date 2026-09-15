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
      length_mm: measurement.length_mm,
      width_mm: measurement.width_mm,
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
1. scale_system 可能是 metric / imperial / dual；不論原尺制為何，value_mm 與 length_mm / width_mm 都已由 measurement service 統一換算成 mm。
2. 可以把 length_mm / width_mm 與 status=measured 的 geometry_steps 當作本次照片的外部實測證據，用來排除尺寸不相容的候選。
3. geometry_steps 中 status=not_measured 的項目不是證據，不得補猜其數值。
4. 每個 geometry step 的 value_mm 只代表該 operation + inputs 所定義的物理距離；請依 purpose 解讀，不要把 axial_distance 自動改名成其他規格。
5. 不可自行修改實測值、四捨五入成另一個標準規格後宣稱照片已證明該標準規格；標準規格仍需結合外觀與 reference 判斷。
6. 不可由這些量測值推導照片沒有實際量到的牙距、孔徑、螺紋規格或其他尺寸。
7. 若你在 specifications 引用量測值，label 請明確寫「系統實測…」，不要把它描述成 AI 目測。
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
任何 status=not_measured 的 geometry step 都不得視為尺寸證據。對需要實際尺寸才能確認的精確規格，請標為 unconfirmed；不要把失敗的量測 diagnostics 當成尺寸證據。
`
}
