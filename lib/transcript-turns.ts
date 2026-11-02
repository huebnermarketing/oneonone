/**
 * Who said what in a 1:1 transcript. The transcription model returns one block of text, so after
 * transcription the AI labels it: the text is split into numbered sentences locally and the model
 * only says WHERE each speaker's turn starts ([{start, speaker}]). It never rewrites the text, so
 * nothing can be dropped or invented — turns are rebuilt from the original sentences.
 *
 * Labels are a best guess from the conversation (who asks, who answers, names used), not from the
 * voices; the UI says so. Stored on MeetingRecording.speakerTurns; null = show plain paragraphs.
 */
import { chatJson, getAiClient } from './ai'
import { buildTurns, splitSentences, type Speaker, type SpeakerTurn, type TurnStart } from './transcript-format'

export { buildTurns, splitSentences, toParagraphs, type Speaker, type SpeakerTurn, type TurnStart } from './transcript-format'

/** Sentences per model call (long meetings are labelled in windows, carrying the last speaker over) */
const WINDOW = 220

/** Accept what the model returns: {turns:[{start, speaker}]} with speaker R/E or the full words. */
export function parseTurnStarts(raw: unknown, offset: number): TurnStart[] {
  const list = Array.isArray(raw) ? raw : (raw as { turns?: unknown })?.turns
  if (!Array.isArray(list)) return []
  return list.flatMap((t) => {
    const start = Number((t as { start?: unknown })?.start)
    const sp = String((t as { speaker?: unknown })?.speaker ?? '').toUpperCase()
    const speaker: Speaker | null = sp.startsWith('R') || sp.startsWith('M') ? 'REPORTER' : sp.startsWith('E') ? 'EMPLOYEE' : null
    return Number.isInteger(start) && speaker ? [{ start: start + offset, speaker }] : []
  })
}

function systemPrompt(reporterName: string, employeeName: string) {
  return `You label speakers in a one-on-one meeting transcript between two people:
- R = ${reporterName || 'the manager'} (the manager who runs the meeting: opens it, asks most questions, gives feedback)
- E = ${employeeName || 'the employee'} (the employee: answers about their work, goals, wellbeing)

The transcript is split into numbered sentences. Return where each speaker's turn STARTS, as JSON:
{"turns":[{"start":<sentence number>,"speaker":"R"|"E"}, ...]}

Rules:
- List a new entry only when the speaker changes. Sentence numbers ascending.
- Use the conversation flow: a question is usually followed by the other person's answer; greetings, names
  ("Hi ${employeeName || 'name'}"), "my goal is…", "I was…" help tell who is speaking.
- Short replies ("Yeah", "Okay", "Great") often belong to the listener — split them out when they clearly respond.
- The text may mix English, Hindi and Gujarati. Do not translate or return any text, only the JSON.`
}

/**
 * AI speaker labelling for a whole transcript. Returns null when there is nothing to label or the
 * model output is unusable (the caller keeps the plain transcript).
 */
export async function labelSpeakers(transcript: string, reporterName: string, employeeName: string): Promise<SpeakerTurn[] | null> {
  const sentences = splitSentences(transcript)
  if (sentences.length < 2) return null
  const ai = await getAiClient()

  const starts: TurnStart[] = []
  let lastSpeaker: Speaker = 'REPORTER'
  for (let from = 0; from < sentences.length; from += WINDOW) {
    const window = sentences.slice(from, from + WINDOW)
    const carry = from > 0 ? `\nThe previous sentence was spoken by ${lastSpeaker === 'REPORTER' ? 'R' : 'E'}; if sentence 0 continues it, start with that speaker.\n` : ''
    const numbered = window.map((s, i) => `[${i}] ${s}`).join('\n')
    const raw = await chatJson<unknown>(ai.client, {
      model: ai.config.chatModel,
      system: systemPrompt(reporterName, employeeName),
      user: `${carry}\nSentences:\n${numbered}`,
      temperature: 0,
    })
    const part = parseTurnStarts(raw, from)
    if (!part.some((p) => p.start === from)) part.unshift({ start: from, speaker: lastSpeaker })
    starts.push(...part)
    lastSpeaker = [...part].sort((a, b) => a.start - b.start).at(-1)!.speaker
  }

  const turns = buildTurns(sentences, starts)
  // A "conversation" with one speaker only means the labelling failed
  return turns.length >= 2 ? turns : null
}
