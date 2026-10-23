import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { ADMIN, withApiAuth } from '@/lib/api'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

// Model metadata for display
const modelMetadata: Record<string, { name: string; description: string; category: string }> = {
  // Latest GPT-4.5 and GPT-4o models
  'gpt-4.5-preview': { name: 'GPT-4.5 Preview', description: 'Latest and most capable', category: 'latest' },
  'gpt-4.5': { name: 'GPT-4.5', description: 'Latest stable release', category: 'latest' },
  'gpt-4o': { name: 'GPT-4o', description: 'Fast & intelligent', category: 'latest' },
  'gpt-4o-2024-11-20': { name: 'GPT-4o (Nov 2024)', description: 'Latest GPT-4o version', category: 'latest' },
  'gpt-4o-2024-08-06': { name: 'GPT-4o (Aug 2024)', description: 'Stable GPT-4o', category: 'latest' },
  'gpt-4o-mini': { name: 'GPT-4o Mini', description: 'Fast & affordable', category: 'latest' },
  'gpt-4o-mini-2024-07-18': { name: 'GPT-4o Mini (Jul 2024)', description: 'Latest mini version', category: 'latest' },
  
  // Reasoning models (o1, o3)
  'o1': { name: 'o1', description: 'Advanced reasoning', category: 'reasoning' },
  'o1-2024-12-17': { name: 'o1 (Dec 2024)', description: 'Latest o1 version', category: 'reasoning' },
  'o1-mini': { name: 'o1-mini', description: 'Fast reasoning', category: 'reasoning' },
  'o1-mini-2024-09-12': { name: 'o1-mini (Sep 2024)', description: 'Latest o1-mini', category: 'reasoning' },
  'o1-preview': { name: 'o1 Preview', description: 'Preview reasoning model', category: 'reasoning' },
  'o1-preview-2024-09-12': { name: 'o1 Preview (Sep 2024)', description: 'o1 preview version', category: 'reasoning' },
  'o3-mini': { name: 'o3-mini', description: 'Latest mini reasoning', category: 'reasoning' },
  
  // GPT-4 Turbo
  'gpt-4-turbo': { name: 'GPT-4 Turbo', description: '128K context', category: 'gpt4' },
  'gpt-4-turbo-2024-04-09': { name: 'GPT-4 Turbo (Apr 2024)', description: 'Stable turbo', category: 'gpt4' },
  'gpt-4-turbo-preview': { name: 'GPT-4 Turbo Preview', description: 'Preview version', category: 'gpt4' },
  
  // GPT-4
  'gpt-4': { name: 'GPT-4', description: 'Original GPT-4', category: 'gpt4' },
  'gpt-4-0613': { name: 'GPT-4 (Jun 2023)', description: 'Stable GPT-4', category: 'gpt4' },
  
  // GPT-3.5
  'gpt-3.5-turbo': { name: 'GPT-3.5 Turbo', description: 'Fast & budget-friendly', category: 'gpt35' },
  'gpt-3.5-turbo-0125': { name: 'GPT-3.5 Turbo (Jan 2025)', description: 'Latest 3.5', category: 'gpt35' },
}

// Priority order for sorting
const categoryOrder = ['latest', 'reasoning', 'gpt4', 'gpt35']
const modelPriority = [
  'gpt-4.5-preview', 'gpt-4.5', 'gpt-4o', 'gpt-4o-mini',
  'o1', 'o1-mini', 'o3-mini',
  'gpt-4-turbo', 'gpt-4',
  'gpt-3.5-turbo'
]

type ModelInfo = { id: string; name: string; description: string; category: string; created: number }

function sortModels(a: ModelInfo, b: ModelInfo): number {
  // Priority list first
  const aPriority = modelPriority.indexOf(a.id)
  const bPriority = modelPriority.indexOf(b.id)
  if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority
  if (aPriority !== -1) return -1
  if (bPriority !== -1) return 1
  // Then by category
  const aCat = categoryOrder.indexOf(a.category)
  const bCat = categoryOrder.indexOf(b.category)
  if (aCat !== bCat) return (aCat === -1 ? 999 : aCat) - (bCat === -1 ? 999 : bCat)
  // Then by creation date (newest first)
  return (b.created || 0) - (a.created || 0)
}

/** Filter the OpenAI model list down to chat/completion models with display metadata, sorted. */
function toChatModels(models: OpenAI.Models.Model[]): ModelInfo[] {
  return models
    .filter((model) => {
      const id = model.id.toLowerCase()
      return (
        (id.includes('gpt-4') ||
          id.includes('gpt-3.5') ||
          id.startsWith('o1') ||
          id.startsWith('o3') ||
          id.includes('chatgpt')) &&
        !id.includes('instruct') &&
        !id.includes('vision') &&
        !id.includes('audio')
      )
    })
    .map((model) => {
      const metadata = modelMetadata[model.id] || { name: model.id, description: 'OpenAI model', category: 'other' }
      return { id: model.id, ...metadata, created: model.created }
    })
    .sort(sortModels)
}

/** Drop dated versions when the base model is present, dedupe, and cap for a clean UI. */
function dedupeModels(chatModels: ModelInfo[]): ModelInfo[] {
  return chatModels
    .reduce((acc: ModelInfo[], model) => {
      const baseId = model.id.replace(/-\d{4}-\d{2}-\d{2}$/, '')
      if (baseId !== model.id && acc.some((m) => m.id === baseId)) return acc
      if (!acc.some((m) => m.id === model.id)) acc.push(model)
      return acc
    }, [])
    .slice(0, 12)
}

// GET /api/settings/models - available OpenAI chat models (admin only).
// Always 200 with { models } so the settings UI can render; OpenAI failures are reported inline as { models: [], error }.
export const GET = withApiAuth(ADMIN, async () => {
  const settings = await getSettings()

  if (!settings.openaiApiKey) {
    return NextResponse.json({ models: [], message: 'OpenAI API key not configured' })
  }

  const openai = new OpenAI({ apiKey: settings.openaiApiKey })

  try {
    const response = await openai.models.list()
    const chatModels = toChatModels(response.data)
    return NextResponse.json({ models: dedupeModels(chatModels), total: chatModels.length })
  } catch (apiError: unknown) {
    console.error('OpenAI API error:', apiError)
    return NextResponse.json({
      models: [],
      error: apiError instanceof Error ? apiError.message : 'Failed to fetch models from OpenAI',
    })
  }
})
