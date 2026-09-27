import assert from 'node:assert/strict'
import { assessNominalLengthConsistency as length } from './nominal-length-consistency'

assert.equal(length('M6 × 1.0 × 40 mm', 40.39, 'metric').status, 'consistent')
assert.equal(length('M6 × 1.0 × 38 mm', 40.39, 'metric').status, 'inconsistent')
assert.equal(length('#8-32 UNC × 13/32 吋', 10.27, 'imperial').status, 'consistent')
assert.equal(length('#8-32 UNC × 3/8 吋', 10.27, 'imperial').status, 'inconsistent')
assert.equal(length('#8-32 × 1 1/4"', 31.75, 'imperial').status, 'consistent')
assert.equal(length('M6 × 1.0 × 40 mm', null, 'metric').status, 'no_trusted_length')
assert.equal(length('未確認規格', 10, 'metric').status, 'unparseable')
assert.equal(length('M6 × 1 × 40', 40, 'metric').status, 'consistent')
assert.equal(length('#8-32 × 7/8', 22.225, 'imperial').status, 'consistent')
console.log('Nominal length compatibility: metric and imperial fractions checked against selected CV L')
