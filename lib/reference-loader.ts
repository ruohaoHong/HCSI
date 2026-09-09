import { readFile } from 'fs/promises'
import path from 'path'
import type { HardwareCategory } from '@/lib/identification'

const CATEGORY_REFERENCE_FILES: Record<HardwareCategory, string> = {
  fasteners: 'fasteners/knowledge.md',
  plumbing: 'plumbing/knowledge.md',
  electrical: 'electrical/knowledge.md',
  'building-hardware': 'building-hardware/knowledge.md',
  'general-repair': 'general-repair/knowledge.md',
  unknown: 'general-repair/knowledge.md',
}

async function readReference(relativePath: string) {
  const fullPath = path.join(process.cwd(), 'data', 'reference', relativePath)
  return readFile(fullPath, 'utf8')
}

export async function loadReferencePack(category: HardwareCategory) {
  const [core, categoryReference] = await Promise.all([
    readReference('core/identification-principles.md'),
    readReference(CATEGORY_REFERENCE_FILES[category]),
  ])

  return {
    core,
    category: categoryReference,
  }
}
