import type { LengthConvention, StandardSystem } from './measurement-v2'

export const STANDARDS_CATALOGUE_SCHEMA = 'hcsi.standards-catalogue.v1' as const

export interface StandardsSource {
  source_id: string
  authority: string
  title: string
  edition: string
  locator: string
  access: 'public_authoritative' | 'licensed_local' | 'derived_engineering'
  role?: 'normative_authority' | 'future_tolerance_authority' | 'length_semantics_reference' | 'secondary_transcription_cross_check'
  notes: string[]
}

export interface ThreadStandardRecord {
  record_id: string
  standard_system: StandardSystem
  family: 'iso_metric_machine_thread' | 'unified_inch_machine_thread'
  series: string
  designation: string
  nominal_diameter_mm: number
  nominal_pitch_mm: number
  tpi: number | null
  length_convention: LengthConvention
  source_ids: string[]
  aliases: string[]
}

export interface StandardsCatalogue {
  schema_version: typeof STANDARDS_CATALOGUE_SCHEMA
  catalogue_id: string
  catalogue_version: string
  snapshot: {
    snapshot_id: string
    snapshot_version: string
    baseline_sha: string
    coverage_status: string
    normative_claim_scope: string[]
    explicitly_not_claimed: string[]
  }
  scope: {
    systems: StandardSystem[]
    families: ThreadStandardRecord['family'][]
  }
  sources: StandardsSource[]
  records: ThreadStandardRecord[]
}

export interface CatalogueValidation { valid: boolean; errors: string[] }

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * Validates the finite candidate universe before it reaches the solver.
 * A plausible D/P pair is not a candidate unless this snapshot already owns
 * a record for it with provenance.
 */
export function validateStandardsCatalogue(catalogue: StandardsCatalogue): CatalogueValidation {
  const errors: string[] = []
  if (catalogue.schema_version !== STANDARDS_CATALOGUE_SCHEMA) errors.push('invalid_schema_version')
  if (!catalogue.catalogue_id.trim()) errors.push('missing_catalogue_id')
  if (!catalogue.catalogue_version.trim()) errors.push('missing_catalogue_version')
  if (!catalogue.snapshot.snapshot_id.trim() || !catalogue.snapshot.snapshot_version.trim()) errors.push('missing_snapshot_identity')
  if (!/^[0-9a-f]{40}$/i.test(catalogue.snapshot.baseline_sha)) errors.push('invalid_baseline_sha')
  if (!catalogue.scope.systems.includes('iso_metric') || !catalogue.scope.systems.includes('unified_inch')) {
    errors.push('phase1_requires_cross_system_scope')
  }

  const sourceIds = new Set<string>()
  for (const source of catalogue.sources) {
    if (!source.source_id.trim()) { errors.push('missing_source_id'); continue }
    if (sourceIds.has(source.source_id)) errors.push(`duplicate_source_id:${source.source_id}`)
    sourceIds.add(source.source_id)
    if (!source.authority.trim() || !source.title.trim() || !source.edition.trim() || !source.locator.trim()) {
      errors.push(`incomplete_source:${source.source_id}`)
    }
  }

  const recordIds = new Set<string>()
  const designationKeys = new Set<string>()
  const seenSystems = new Set<StandardSystem>()
  for (const record of catalogue.records) {
    if (!record.record_id.trim()) { errors.push('missing_record_id'); continue }
    if (recordIds.has(record.record_id)) errors.push(`duplicate_record_id:${record.record_id}`)
    recordIds.add(record.record_id)
    seenSystems.add(record.standard_system)
    const key = `${record.standard_system}:${record.designation.toLowerCase().replace(/\s+/g,'')}`
    if (designationKeys.has(key)) errors.push(`duplicate_designation:${key}`)
    designationKeys.add(key)
    if (!catalogue.scope.systems.includes(record.standard_system)) errors.push(`system_outside_scope:${record.record_id}`)
    if (!catalogue.scope.families.includes(record.family)) errors.push(`family_outside_scope:${record.record_id}`)
    if (!record.designation.trim() || !record.series.trim()) errors.push(`incomplete_designation:${record.record_id}`)
    if (!positiveFinite(record.nominal_diameter_mm)) errors.push(`invalid_diameter:${record.record_id}`)
    if (!positiveFinite(record.nominal_pitch_mm)) errors.push(`invalid_pitch:${record.record_id}`)
    if (record.standard_system === 'unified_inch' && !positiveFinite(record.tpi)) errors.push(`missing_unified_tpi:${record.record_id}`)
    if (record.standard_system === 'iso_metric' && record.tpi !== null) errors.push(`unexpected_metric_tpi:${record.record_id}`)
    if (record.source_ids.length === 0) errors.push(`missing_provenance:${record.record_id}`)
    for (const sourceId of record.source_ids) if (!sourceIds.has(sourceId)) errors.push(`unknown_source:${record.record_id}:${sourceId}`)
  }
  if (!seenSystems.has('iso_metric') || !seenSystems.has('unified_inch')) errors.push('catalogue_missing_cross_system_records')
  return { valid: errors.length === 0, errors }
}

export function getCatalogueRecord(catalogue: StandardsCatalogue, recordId: string): ThreadStandardRecord | null {
  return catalogue.records.find(record => record.record_id === recordId) ?? null
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g,'').replace(/×/g,'x')
}

export function findCatalogueDesignation(catalogue: StandardsCatalogue, designation: string): ThreadStandardRecord | null {
  const query = normalize(designation)
  return catalogue.records.find(record =>
    [record.designation, ...record.aliases].some(form => query.includes(normalize(form)))
  ) ?? null
}
