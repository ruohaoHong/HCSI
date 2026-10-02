import { createHash } from 'node:crypto'

/**
 * Canonical JSON-like serialization for lineage digests.
 * Object keys are sorted recursively and non-finite/undefined values are rejected.
 */
export function canonicalDeterministicSerialize(value:unknown):string{
  if(value===null) return 'null'
  if(Array.isArray(value)) return `[${value.map(canonicalDeterministicSerialize).join(',')}]`
  switch(typeof value){
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      if(!Number.isFinite(value)) throw new Error('canonical_digest_non_finite_number')
      return JSON.stringify(value)
    case 'object': {
      const entries=Object.entries(value as Record<string,unknown>)
      if(entries.some(([,v])=>typeof v==='undefined')) throw new Error('canonical_digest_undefined_value')
      return `{${entries.sort(([a],[b])=>a.localeCompare(b))
        .map(([k,v])=>`${JSON.stringify(k)}:${canonicalDeterministicSerialize(v)}`).join(',')}}`
    }
    default:
      throw new Error(`canonical_digest_unsupported_type:${typeof value}`)
  }
}

export function sha256Canonical(value:unknown):string{
  return createHash('sha256').update(canonicalDeterministicSerialize(value)).digest('hex')
}

export function isSha256(value:unknown):value is string{
  return typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)
}
