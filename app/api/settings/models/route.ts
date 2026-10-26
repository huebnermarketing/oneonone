import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ADMIN, parseQuery, withApiAuth } from '@/lib/api'
import { isAiConfigured, listModels } from '@/lib/ai'

export const dynamic = 'force-dynamic'

const query = z.object({ kind: z.enum(['chat', 'transcription']).default('chat') })

/**
 * GET /api/settings/models?kind=chat|transcription — models available on the configured provider (admin only).
 * Always 200 with { models } so the settings UI can render; provider failures are reported inline as { models: [], error }.
 */
export const GET = withApiAuth(ADMIN, async (req: NextRequest) => {
  const { kind } = parseQuery(req, query)

  if (!(await isAiConfigured())) {
    return NextResponse.json({ models: [], message: 'AI provider API key not configured' })
  }

  try {
    const models = await listModels(kind)
    return NextResponse.json({ models, total: models.length })
  } catch (apiError: unknown) {
    console.error('[settings/models] provider error:', apiError)
    return NextResponse.json({
      models: [],
      error: apiError instanceof Error ? apiError.message : 'Failed to fetch models from the AI provider',
    })
  }
})
