import {
  STANDARDS_CATALOGUE_SCHEMA,
  type StandardsCatalogue,
  type ThreadStandardRecord,
  validateStandardsCatalogue,
} from './standards-catalogue'

const BASELINE_SHA = 'd83cc7c6e0f8f2c95d394e1f30b1c394e3df36a2'
const MM_PER_INCH = 25.4

type MetricTuple = [string, number, number, string]
type UnifiedTuple = [string, number, number, string]

const METRIC: MetricTuple[] = [
  ['M1',1,0.25,'coarse'],['M1.2',1.2,0.25,'coarse'],['M1.4',1.4,0.3,'coarse'],['M1.6',1.6,0.35,'coarse'],
  ['M2',2,0.4,'coarse'],['M2.5',2.5,0.45,'coarse'],['M3',3,0.5,'coarse'],['M3.5',3.5,0.6,'coarse'],
  ['M4',4,0.7,'coarse'],['M5',5,0.8,'coarse'],['M6',6,1,'coarse'],['M8',8,1.25,'coarse'],
  ['M10',10,1.5,'coarse'],['M12',12,1.75,'coarse'],['M14',14,2,'coarse'],['M16',16,2,'coarse'],
  ['M18',18,2.5,'coarse'],['M20',20,2.5,'coarse'],['M22',22,2.5,'coarse'],['M24',24,3,'coarse'],
  ['M8',8,1,'fine'],['M10',10,1.25,'fine'],['M10',10,1,'fine'],['M12',12,1.5,'fine'],
  ['M12',12,1.25,'fine'],['M14',14,1.5,'fine'],['M16',16,1.5,'fine'],['M18',18,2,'fine'],
  ['M18',18,1.5,'fine'],['M20',20,2,'fine'],['M20',20,1.5,'fine'],['M22',22,2,'fine'],
  ['M22',22,1.5,'fine'],['M24',24,2,'fine'],
]

const UNIFIED: UnifiedTuple[] = [
  ['#1',0.073,64,'UNC'],['#2',0.086,56,'UNC'],['#3',0.099,48,'UNC'],['#4',0.112,40,'UNC'],
  ['#5',0.125,40,'UNC'],['#6',0.138,32,'UNC'],['#8',0.164,32,'UNC'],['#10',0.190,24,'UNC'],
  ['#10',0.190,32,'UNF'],['#12',0.216,24,'UNC'],['1/4',0.25,20,'UNC'],['1/4',0.25,28,'UNF'],
  ['5/16',0.3125,18,'UNC'],['5/16',0.3125,24,'UNF'],['3/8',0.375,16,'UNC'],['3/8',0.375,24,'UNF'],
  ['7/16',0.4375,14,'UNC'],['7/16',0.4375,20,'UNF'],['1/2',0.5,13,'UNC'],['1/2',0.5,20,'UNF'],
  ['9/16',0.5625,12,'UNC'],['9/16',0.5625,18,'UNF'],['5/8',0.625,11,'UNC'],['5/8',0.625,18,'UNF'],
  ['3/4',0.75,10,'UNC'],['3/4',0.75,16,'UNF'],['7/8',0.875,9,'UNC'],['7/8',0.875,14,'UNF'],
  ['1',1,8,'UNC'],['1',1,12,'UNF'],
]

function metricRecords(): ThreadStandardRecord[] {
  return METRIC.map(([name, d, p, series], index) => ({
    record_id: `metric-${index + 1}-${name.toLowerCase().replace('.','_')}-p${String(p).replace('.','_')}`,
    standard_system: 'iso_metric',
    family: 'iso_metric_machine_thread',
    series,
    designation: `${name} × ${p.toFixed(p % 1 === 0 ? 1 : 2).replace(/0$/,'')}`,
    nominal_diameter_mm: d,
    nominal_pitch_mm: p,
    tpi: null,
    length_convention: 'family_specific',
    source_ids: ['iso-262-2023','iso-261-1998','iso-724-2023','secondary-thread-table'],
    aliases: [`${name}x${p}`],
  }))
}

function unifiedRecords(): ThreadStandardRecord[] {
  return UNIFIED.map(([name, dIn, tpi, series], index) => ({
    record_id: `unified-${index + 1}-${name.replace(/[#/]/g,'_')}-${tpi}-${series.toLowerCase()}`,
    standard_system: 'unified_inch',
    family: 'unified_inch_machine_thread',
    series,
    designation: `${name}-${tpi} ${series}`,
    nominal_diameter_mm: dIn * MM_PER_INCH,
    nominal_pitch_mm: MM_PER_INCH / tpi,
    tpi,
    length_convention: 'family_specific',
    source_ids: ['asme-b1-1-2024','secondary-thread-table'],
    aliases: [`${name}-${tpi}`],
  }))
}

/**
 * Phase-1 catalogue is intentionally a versioned curated machine-thread subset.
 * It is the solver's finite candidate universe, not a claim that every row or
 * product dimension from the underlying standards has been reproduced.
 */
export const STANDARDS_CATALOGUE_V1: StandardsCatalogue = {
  schema_version: STANDARDS_CATALOGUE_SCHEMA,
  catalogue_id: 'hcsi-machine-threads-v1',
  catalogue_version: '1.0.0',
  snapshot: {
    snapshot_id: 'hcsi-standards-v1-2026-10-01',
    snapshot_version: '1.0.0',
    baseline_sha: BASELINE_SHA,
    coverage_status: 'phase1_curated_machine_thread_subset',
    normative_claim_scope: [
      'loaded ISO metric machine-thread designations and nominal D/P pairs',
      'loaded Unified inch machine-thread designations and nominal diameter/TPI pairs',
      'candidate validity only within this loaded versioned snapshot',
    ],
    explicitly_not_claimed: [
      'complete ISO/ASME tables or tolerance classes',
      'product-standard head geometry or nominal product-length validity',
      'commercial availability, stock, material, coating, strength grade, or Taiwan purchase wording',
    ],
  },
  scope: {
    systems: ['iso_metric','unified_inch'],
    families: ['iso_metric_machine_thread','unified_inch_machine_thread'],
  },
  sources: [
    { source_id:'iso-262-2023', authority:'ISO', title:'ISO general purpose metric screw threads — Selected sizes for bolts, screws, studs and nuts', edition:'ISO 262:2023, Edition 3', locator:'https://www.iso.org/standard/85110.html', access:'public_authoritative', role:'normative_authority', notes:['Official ISO catalogue metadata; Phase 1 stores a curated selected-size subset, not the copyrighted standard text.'] },
    { source_id:'iso-261-1998', authority:'ISO', title:'ISO general purpose metric screw threads — General plan', edition:'ISO 261:1998, Edition 2 (confirmed 2024)', locator:'https://www.iso.org/standard/30711.html', access:'public_authoritative', role:'normative_authority', notes:[] },
    { source_id:'iso-724-2023', authority:'ISO', title:'ISO general-purpose metric screw threads — Basic dimensions', edition:'ISO 724:2023, Edition 3', locator:'https://www.iso.org/standard/85109.html', access:'public_authoritative', role:'normative_authority', notes:[] },
    { source_id:'iso-965-1-2026', authority:'ISO', title:'ISO general purpose metric screw threads — Tolerances — Part 1', edition:'ISO 965-1:2026, Edition 5', locator:'https://www.iso.org/standard/83676.html', access:'public_authoritative', role:'future_tolerance_authority', notes:['Recorded for later tolerance likelihood work; Phase 1 does not claim tolerance-class validation.'] },
    { source_id:'asme-b1-1-2024', authority:'ASME', title:'Unified Inch Screw Threads (UN, UNR, and UNJ Thread Forms)', edition:'ASME B1.1-2024', locator:'https://www.asme.org/codes-standards/find-codes-standards/b1-1-unified-inch-screw-threads-un-unr-thread-form', access:'public_authoritative', role:'normative_authority', notes:['Official ASME metadata; Phase 1 stores a curated designation subset, not the copyrighted standard text.'] },
    { source_id:'iso-888-2012', authority:'ISO', title:'Bolts, screws and studs — Nominal lengths and thread lengths', edition:'ISO 888:2012 (confirmed 2023)', locator:'https://www.iso.org/standard/52549.html', access:'public_authoritative', role:'length_semantics_reference', notes:['Length comparison is not yet product-standard validity.'] },
    { source_id:'secondary-thread-table', authority:'Sucatec', title:'Thread standards reference tables', edition:'accessed 2026-10-01', locator:'https://www.sucatec.com/en/thread-standards/', access:'derived_engineering', role:'secondary_transcription_cross_check', notes:['Secondary cross-check only; normative authority remains the listed ISO/ASME standards.'] },
  ],
  records: [...metricRecords(), ...unifiedRecords()],
}

const validation = validateStandardsCatalogue(STANDARDS_CATALOGUE_V1)
if (!validation.valid) throw new Error(`invalid_standards_catalogue_v1:${validation.errors.join('|')}`)
