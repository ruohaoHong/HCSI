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

  if (measurement.measurement_status === 'valid') {
    const evidence = {
      measurement_status: measurement.measurement_status,
      length_mm: measurement.length_mm,
      width_mm: measurement.width_mm,
      scale_px_per_cm: measurement.scale_px_per_cm,
      risk_signals: measurement.object.risk_signals,
      capture_assumptions: measurement.capture_assumptions,
    }
    return `
===== HCSI 尺寸證據層 =====
以下 JSON 是程式的 deterministic 幾何量測結果，不是 Vision LLM 的目測：
${JSON.stringify(evidence, null, 2)}

規則：
1. 可以把 length_mm / width_mm 當作本次照片的外部實測證據，用來排除尺寸不相容的候選。
2. 不可自行修改、四捨五入成另一個標準規格後宣稱照片已證明該標準規格；標準規格仍需結合外觀與 reference 判斷。
3. 不可由這兩個量測值推導照片沒有實際量到的牙距、孔徑、螺紋規格或其他尺寸。
4. 若你在 specifications 引用這兩個值，label 請明確寫「系統實測長度」或「系統實測寬度」，不要把它描述成 AI 目測。
`
  }

  const message = measurement.measurement_status === 'no_reference'
    ? '目前影像中沒有建立出可確認的尺度參考，因此本次只能進行 appearance-only identification。'
    : '目前影像雖有尺度／幾何線索，但 deterministic measurement preflight 判定不足以可靠輸出實際尺寸。'

  return `
===== HCSI 尺寸證據層 =====
${message}
measurement_status: ${measurement.measurement_status}
reason_codes: ${measurement.reason_codes.join(', ') || 'none'}

你仍可辨識五金種類、結構與用途，但不得只靠照片中的 pixel 大小、視覺比例或主觀目測自行產生任何數值 mm / cm / inch 規格。
對需要實際尺寸才能確認的精確規格，請標為 unconfirmed；不要把失敗的量測 diagnostics 當成尺寸證據。
`
}
