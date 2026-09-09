import { handleIdentificationRequest } from '@/lib/provider-runner'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  return handleIdentificationRequest(request, 'grok')
}
