export interface DriveEvidence {
  display_form: string
  form_observed: boolean
  size_status: 'not_measured'
  reason_codes: string[]
}

const UNKNOWN_DRIVE = /unknown|待確認|未確認|不可見|無法|看不清/i
const DRIVE_SIZE = /(?:#\s*\d+|PH\s*\d+|PZ\s*\d+|T\s*\d+|H\s*\d+|\d+(?:\.\d+)?\s*mm)\b/ig
const DRIVE_CODE_IN_TEXT = /\b(?:PH|PZ|T|H)\s*\d+\b/ig
const DRIVE_MM_IN_TEXT = /((?:內六角|驅動槽|槽孔)\s*)\d+(?:\.\d+)?\s*mm\b/ig

function genericDriveForm(value: string): string | null {
  if (/十字|phillips/i.test(value)) return '十字'
  if (/一字|slotted|flat[\s-]?blade/i.test(value)) return '一字'
  if (/torx|梅花/i.test(value)) return '梅花'
  if (/內六角|hex[\s-]?socket|allen/i.test(value)) return '內六角'
  if (/外六角|external[\s-]?hex/i.test(value)) return '外六角'
  if (/方形|square|robertson/i.test(value)) return '方形'
  return null
}

export function sanitizeDriveEvidence(raw: string): DriveEvidence {
  const value = raw.trim()
  if (!value || UNKNOWN_DRIVE.test(value)) {
    return {
      display_form: '待確認',
      form_observed: false,
      size_status: 'not_measured',
      reason_codes: ['drive_form_not_observable', 'drive_size_not_measured'],
    }
  }
  const containsSize = DRIVE_SIZE.test(value)
  DRIVE_SIZE.lastIndex = 0
  if (containsSize) {
    const generic = genericDriveForm(value)
    return {
      display_form: generic ? generic + '（尺寸待確認）' : '待確認',
      form_observed: generic !== null,
      size_status: 'not_measured',
      reason_codes: ['unverified_drive_size_removed'],
    }
  }
  return {
    display_form: value,
    form_observed: true,
    size_status: 'not_measured',
    reason_codes: ['drive_size_not_measured'],
  }
}

export function stripUnverifiedDriveSizeClaims(value: string): string {
  return value
    .replace(DRIVE_CODE_IN_TEXT, '尺寸待確認')
    .replace(DRIVE_MM_IN_TEXT, '$1尺寸待確認')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
