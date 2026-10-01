import { STANDARDS_CATALOGUE_V1 } from './standards-database-v1'
import { findCatalogueDesignation, validateStandardsCatalogue } from './standards-catalogue'

function ok(v: unknown, m='assertion failed'): asserts v { if (!v) throw new Error(m) }
function equal(a: unknown,b: unknown,m='values differ') { if (a !== b) throw new Error(`${m}: ${String(a)} !== ${String(b)}`) }

const validation = validateStandardsCatalogue(STANDARDS_CATALOGUE_V1)
equal(validation.valid,true,validation.errors.join(','))
equal(STANDARDS_CATALOGUE_V1.snapshot.baseline_sha,'d83cc7c6e0f8f2c95d394e1f30b1c394e3df36a2')
equal(STANDARDS_CATALOGUE_V1.records.length,64)
ok(findCatalogueDesignation(STANDARDS_CATALOGUE_V1,'M14 × 2.0'))
ok(findCatalogueDesignation(STANDARDS_CATALOGUE_V1,'#8-32 × 13/32 in'))
ok(findCatalogueDesignation(STANDARDS_CATALOGUE_V1,'9/16-12 UNC'))
equal(findCatalogueDesignation(STANDARDS_CATALOGUE_V1,'#37-12 × 1 7/8 in'),null)

const invalid = structuredClone(STANDARDS_CATALOGUE_V1)
invalid.records[0].source_ids = []
equal(validateStandardsCatalogue(invalid).valid,false)

console.log('standards DB v1: 64 catalogue-backed machine-thread records validated; #37-12 absent')
