import assert from 'node:assert/strict'
import {
  HEAD_STYLE_SEMANTIC_GUIDANCE,
  HEAD_STYLE_VALUES,
  PROTRUDING_HEAD_STYLES,
} from './head-style-taxonomy'

assert.equal(new Set(HEAD_STYLE_VALUES).size, HEAD_STYLE_VALUES.length)
assert.equal(HEAD_STYLE_VALUES.includes('truss'), true,
  'localization and final identification must share the truss candidate')
assert.equal(PROTRUDING_HEAD_STYLES.includes('truss'), true)
assert.match(HEAD_STYLE_SEMANTIC_GUIDANCE, /near|等寬|側裙/i,
  'pan semantics must describe its lower skirt instead of a catalogue ratio')
assert.match(HEAD_STYLE_SEMANTIC_GUIDANCE, /truss：[\s\S]*承面[\s\S]*持續收窄/,
  'truss semantics must distinguish a shallow continuously tapering dome')
assert.match(HEAD_STYLE_SEMANTIC_GUIDANCE, /不要只因名稱翻譯不確定而填 other/)
assert.match(HEAD_STYLE_SEMANTIC_GUIDANCE, /真的看不清楚才用 unknown/)
assert.doesNotMatch(HEAD_STYLE_SEMANTIC_GUIDANCE, /\b\d+(?:\.\d+)?\s*(?:mm|in|%)/i,
  'semantic guidance must not smuggle dimensional thresholds into head classification')

console.log('Head-style taxonomy: shared enums and qualitative silhouette semantics stay consistent')
