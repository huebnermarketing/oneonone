/**
 * Client-safe transcript helpers: sentence splitting, rebuilding speaker turns from turn starts,
 * plain paragraphs. The AI labelling lives in lib/transcript-turns.ts (server only).
 */
export type Speaker = 'REPORTER' | 'EMPLOYEE'

export interface SpeakerTurn {
  speaker: Speaker
  text: string
}

/** Unpunctuated runs are cut into pieces of this many words so a boundary can fall inside them */
const MAX_WORDS = 40
const PIECE_WORDS = 25

/** Sentence-ish pieces of the transcript, in order; joining them with ' ' gives the text back. */
export function splitSentences(transcript: string): string[] {
  const rough = transcript
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.?!।॥…])\s+/)
    .filter(Boolean)
  return rough.flatMap((s) => {
    const words = s.split(' ')
    if (words.length <= MAX_WORDS) return [s]
    const pieces: string[] = []
    for (let i = 0; i < words.length; i += PIECE_WORDS) pieces.push(words.slice(i, i + PIECE_WORDS).join(' '))
    return pieces
  })
}

export interface TurnStart {
  start: number
  speaker: Speaker
}

/**
 * Pure: turn starts (any order, possibly sloppy) → clean turns over all sentences. Out-of-range or
 * duplicate starts are dropped, the first turn always starts at 0 (with `firstSpeaker` if the model
 * skipped it), and consecutive turns by the same person are merged.
 */
export function buildTurns(sentences: string[], starts: TurnStart[], firstSpeaker: Speaker = 'REPORTER'): SpeakerTurn[] {
  if (sentences.length === 0) return []
  const valid = new Map<number, Speaker>()
  for (const s of starts) {
    if (Number.isInteger(s.start) && s.start >= 0 && s.start < sentences.length && (s.speaker === 'REPORTER' || s.speaker === 'EMPLOYEE')) {
      if (!valid.has(s.start)) valid.set(s.start, s.speaker)
    }
  }
  if (!valid.has(0)) valid.set(0, firstSpeaker)
  const ordered = [...valid.entries()].sort((a, b) => a[0] - b[0])

  const turns: SpeakerTurn[] = []
  ordered.forEach(([start, speaker], i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1]![0] : sentences.length
    const text = sentences.slice(start, end).join(' ')
    const last = turns.at(-1)
    if (last && last.speaker === speaker) last.text = `${last.text} ${text}`
    else turns.push({ speaker, text })
  })
  return turns
}

/** Plain paragraphs (every few sentences) for transcripts without speaker turns. */
export function toParagraphs(transcript: string, sentencesPerParagraph = 4): string[] {
  const sentences = splitSentences(transcript)
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) out.push(sentences.slice(i, i + sentencesPerParagraph).join(' '))
  return out
}
