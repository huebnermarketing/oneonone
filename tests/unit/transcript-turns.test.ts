import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai', () => ({
  getAiClient: vi.fn(async () => ({ client: {}, config: { chatModel: 'm' } })),
  chatJson: vi.fn(),
}))

import { chatJson } from '@/lib/ai'
import { buildTurns, labelSpeakers, parseTurnStarts, splitSentences, toParagraphs } from '@/lib/transcript-turns'

const T = 'Hey, hi Mokshi, how are you? I am fine. How are you? Yeah, I am good. So my first question is about goals. My goal is automation testing.'

describe('splitSentences', () => {
  it('splits on . ? ! and the Devanagari danda, keeps every word', () => {
    const s = splitSentences(T)
    expect(s).toEqual(['Hey, hi Mokshi, how are you?', 'I am fine.', 'How are you?', 'Yeah, I am good.', 'So my first question is about goals.', 'My goal is automation testing.'])
    expect(splitSentences('मैं ठीक हूँ। आप कैसे हैं?')).toHaveLength(2)
    expect(s.join(' ')).toBe(T)
  })
  it('cuts long unpunctuated runs so a speaker change can fall inside them', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const s = splitSentences(long)
    expect(s).toHaveLength(3)
    expect(s.join(' ')).toBe(long)
  })
})

describe('buildTurns', () => {
  const s = splitSentences(T)
  it('rebuilds turns from starts, merges same-speaker runs, ignores junk', () => {
    const turns = buildTurns(s, [
      { start: 1, speaker: 'EMPLOYEE' },
      { start: 2, speaker: 'EMPLOYEE' }, // same speaker → merged
      { start: 3, speaker: 'REPORTER' },
      { start: 5, speaker: 'EMPLOYEE' },
      { start: 99, speaker: 'REPORTER' }, // out of range
    ])
    expect(turns).toEqual([
      { speaker: 'REPORTER', text: 'Hey, hi Mokshi, how are you?' },
      { speaker: 'EMPLOYEE', text: 'I am fine. How are you?' },
      { speaker: 'REPORTER', text: 'Yeah, I am good. So my first question is about goals.' },
      { speaker: 'EMPLOYEE', text: 'My goal is automation testing.' },
    ])
    expect(turns.map((t) => t.text).join(' ')).toBe(T) // nothing lost
  })
})

describe('parseTurnStarts', () => {
  it('accepts {turns:[…]} or a bare array, R/E or full words, applies the window offset', () => {
    expect(parseTurnStarts({ turns: [{ start: 0, speaker: 'R' }, { start: 2, speaker: 'E' }] }, 100)).toEqual([
      { start: 100, speaker: 'REPORTER' },
      { start: 102, speaker: 'EMPLOYEE' },
    ])
    expect(parseTurnStarts([{ start: '1', speaker: 'employee' }, { start: 'x', speaker: 'R' }, { start: 3, speaker: '?' }], 0)).toEqual([{ start: 1, speaker: 'EMPLOYEE' }])
    expect(parseTurnStarts('nonsense', 0)).toEqual([])
  })
})

describe('labelSpeakers', () => {
  it('numbers sentences for the model and builds turns from its answer', async () => {
    vi.mocked(chatJson).mockImplementation(async () => ({ turns: [{ start: 0, speaker: 'R' }, { start: 1, speaker: 'E' }, { start: 3, speaker: 'R' }, { start: 5, speaker: 'E' }] }))
    const turns = await labelSpeakers(T, 'Tarang', 'Mokshi')
    expect(turns).toHaveLength(4)
    const call = vi.mocked(chatJson).mock.calls[0][1] as { user: string; system: string }
    expect(call.user).toContain('[0] Hey, hi Mokshi')
    expect(call.system).toContain('R = Tarang')
  })
  it('one speaker only → null (unusable)', async () => {
    vi.mocked(chatJson).mockImplementation(async () => ({ turns: [{ start: 0, speaker: 'R' }] }))
    expect(await labelSpeakers(T, 'A', 'B')).toBeNull()
  })
  it('a single sentence is not labelled', async () => {
    expect(await labelSpeakers('Hello there.', 'A', 'B')).toBeNull()
  })
})

describe('toParagraphs', () => {
  it('groups sentences', () => expect(toParagraphs(T, 4)).toHaveLength(2))
})
