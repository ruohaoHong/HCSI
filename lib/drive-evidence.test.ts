import assert from 'node:assert/strict'
import { sanitizeDriveEvidence, stripUnverifiedDriveSizeClaims } from './drive-evidence'

assert.equal(sanitizeDriveEvidence('unknown').display_form, '待確認')
assert.equal(sanitizeDriveEvidence('Phillips #2').display_form, '十字（尺寸待確認）')
assert.equal(sanitizeDriveEvidence('PH2 十字').display_form, '十字（尺寸待確認）')
assert.equal(sanitizeDriveEvidence('Torx T20').display_form, '梅花（尺寸待確認）')
assert.equal(sanitizeDriveEvidence('內六角 4mm').display_form, '內六角（尺寸待確認）')
assert.equal(sanitizeDriveEvidence('外六角').display_form, '外六角')
assert.equal(sanitizeDriveEvidence('十字').reason_codes.includes('drive_size_not_measured'), true)
assert.equal(
  stripUnverifiedDriveSizeClaims('M3 × 0.5 × 12 mm，PH2 十字'),
  'M3 × 0.5 × 12 mm，尺寸待確認 十字',
)
assert.equal(
  stripUnverifiedDriveSizeClaims('#10-24 × 7/8 in，內六角 4mm'),
  '#10-24 × 7/8 in，內六角 尺寸待確認',
)
console.log('Drive evidence: observable form is preserved and every unmeasured size token is removed')
