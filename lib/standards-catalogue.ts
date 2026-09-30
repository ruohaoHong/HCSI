import type { LengthConvention, StandardSystem } from './measurement-v2'

export const STANDARDS_CATALOGUE_SCHEMA = 'hcsi.standards-catalogue.v1' as const

export interface StandardsSource {
  source_id: string
  authority: string
  title: string
  edition: string
  locator: string
  access: 'public_authoritative' | 'licensed_local' | 'derived_engineering'
  notes: string[]
}

export interface ThreadStandardRecord {
  record_id: string
  standard_system: StandardSystem
  family: string
  designation: string
  nominal_diameter_mm: number
  nominal_pitch_mm: number
  length_convention: LengthConvention
  source_ids: string[]
  aliases: string[]
}

export interface StandardsCatalogue {
  schema_version: typeof STANDARDS_CATALOGUE_SCHEMA
  catalogue_id: string
  catalogue_version: string
  scope: {
    systems: StandardSystem[]
    families: string[]
  }
  sources: StandardsSource[]
  records: ThreadStandardRecord[]
}

export interface CatalogueValidation {
  valid: boolean
  errors: string[]
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

const LENGTH_CONVENTIONS = new Set<LengthConvention>([
  'head_underface_to_tip',
  'head_top_to_tip',
  'set_screw_overall',
  'family_specific',
  'unknown',
])

/**
 * Validate the finite normative universe before it can be used by a solver.
 * A record with missing provenance is invalid even if its dimensions happen
 * to fit a measurement. This prevents arithmetic-generated designations from
 * silently becoming standards-backed candidates.
 */
export function validateStandardsCatalogue(catalogue: StandardsCatalogue): CatalogueValidation {
  const errors: string[] = []
  if (catalogue.schema_version !== STANDARDS_CATALOGUE_SCHEMA) {
    errors.push('invalid_schema_version')
  }
  if (!catalogue.catalogue_id.trim()) errors.push('missing_catalogue_id')
  if (!catalogue.catalogue_version.trim()) errors.push('missing_catalogue_version')

  const sourceIds = new Set<string>()
  for (const source of catalogue.sources) {
    if (!source.source_id.trim()) {
      errors.push('missing_source_id')
      continue
    }
    if (sourceIds.has(source.source_id)) errors.push(`duplicate_source_id:${source.source_id}`)
    sourceIds.add(source.source_id)
    if (!source.authority.trim() || !source.title.trim() || !source.edition.trim() ||
        !source.locator.trim()) {
      errors.push(`incomplete_source:${source.source_id}`)
    }
  }

  const recordIds = new Set<string>()
  const designations = new Set<string>()
  for (const record of catalogue.records) {
    if (!record.record_id.trim()) {
      errors.push('missing_record_id')
      continue
    }
    if (recordIds.has(record.record_id)) errors.push(`duplicate_record_id:${record.record_id}`)
    recordIds.add(record.record_id)

    const designationKey = `${record.standard_system}:${record.family}:${record.designation}`
    if (designations.has(designationKey)) errors.push(`duplicate_designation:${designationKey}`)
    designations.add(designationKey)

    if (!catalogue.scope.systems.includes(record.standard_system)) {
      errors.push(`system_outside_scope:${record.record_id}`)
    }
    if (!catalogue.scope.families.includes(record.family)) {
      errors.push(`family_outside_scope:${record.record_id}`)
    }
    if (!record.designation.trim()) errors.push(`missing_designation:${record.record_id}`)
    if (!positiveFinite(record.nominal_diameter_mm)) {
      errors.push(`invalid_diameter:${record.record_id}`)
    }
    if (!positiveFinite(record.nominal_pitch_mm)) {
      errors.push(`invalid_pitch:${record.record_id}`)
    }
    if (!LENGTH_CONVENTIONS.has(record.length_convention)) {
      errors.push(`invalid_length_convention:${record.record_id}`)
    }
    if (record.source_ids.length === 0) errors.push(`missing_provenance:${record.record_id}`)
    for (const sourceId of record.source_ids) {
      if (!sourceIds.has(sourceId)) errors.push(`unknown_source:${record.record_id}:${sourceId}`)
    }
  }

  return { valid: errors.length === 0, errors }
}

export function getCatalogueRecord(
  catalogue: StandardsCatalogue,
  recordId: string,
): ThreadStandardRecord | null {
  return catalogue.records.find(record => record.record_id === recordId) ?? null
}
