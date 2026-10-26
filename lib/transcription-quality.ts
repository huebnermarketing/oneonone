/**
 * Pure helpers that make speech-to-text output usable for Indic + English meetings.
 * No I/O here — everything is unit-testable; lib/openai.ts wires them into the transcription flow.
 */

export interface TranscriptionContext {
  /** Names spoken in the meeting (employee, reporter) — steers spelling of proper nouns. */
  participantNames?: string[]
}

/**
 * Steering prompt per language. Whisper-family models treat the prompt as "text that came before",
 * so a sentence in the target script locks the output script (whisper-1 otherwise drifts from
 * Gujarati to Devanagari on code-mixed speech) and seeds workplace vocabulary. Kept well under the
 * ~224-token prompt budget.
 */
const SCRIPT_PRIMERS: Record<string, string> = {
  gu: 'આ મેનેજર અને કર્મચારી વચ્ચેની વન-ઓન-વન મીટિંગ છે. વાતચીતમાં ગુજરાતી અને અંગ્રેજી બંને શબ્દો વપરાય છે: project, deadline, client, feedback.',
  hi: 'यह मैनेजर और कर्मचारी के बीच की वन-ऑन-वन मीटिंग है। बातचीत में हिंदी और अंग्रेज़ी दोनों शब्द इस्तेमाल होते हैं: project, deadline, client, feedback.',
  mr: 'ही मॅनेजर आणि कर्मचारी यांच्यातील वन-ऑन-वन मीटिंग आहे. संभाषणात मराठी आणि इंग्रजी दोन्ही शब्द वापरले जातात: project, deadline, client, feedback.',
  en: 'This is a one-on-one meeting between a manager and an employee about projects, deadlines, clients, goals and feedback.',
}

const AUTO_PRIMER =
  'This is a one-on-one meeting between a manager and an employee. It may be in English, Hindi or Gujarati, often mixed with English terms such as project, deadline, client, feedback. Transcribe each language in its own script.'

export function buildTranscriptionPrompt(language: string | undefined, context?: TranscriptionContext): string {
  const base = language && SCRIPT_PRIMERS[language] ? SCRIPT_PRIMERS[language] : language ? SCRIPT_PRIMERS.en : AUTO_PRIMER
  const names = (context?.participantNames ?? []).map((n) => n.trim()).filter(Boolean)
  return names.length ? `${base} Participants: ${names.join(', ')}.` : base
}

/** gpt-4o-transcribe / gpt-4o-mini-transcribe: no verbose_json, no language in the reply, ~25-min cap per request. */
export const isGpt4oTranscribe = (model: string) => /gpt-4o(-mini)?-transcribe/i.test(model)

/** Per-request audio cap in seconds for models that have one; undefined = provider default applies. */
export function modelSegmentCap(model: string): number | undefined {
  return isGpt4oTranscribe(model) ? 23 * 60 : undefined
}

/** Response format to ask for first — skips a guaranteed 400 round-trip on models that reject verbose_json. */
export function preferredResponseFormat(model: string): 'verbose_json' | 'json' {
  return isGpt4oTranscribe(model) ? 'json' : 'verbose_json'
}

/**
 * Hallucination guard. Whisper-family models loop on low-signal audio ("…problem je ye problem…"
 * repeated to the end of the segment). Collapse any phrase of 2–20 words that repeats 3+ times
 * back-to-back down to a single occurrence. Real speech almost never repeats a 2+ word phrase
 * three times verbatim in a row, so this is safe; at worst it shortens a chant.
 */
export function collapseRepetitions(text: string, minRepeats = 3): { text: string; removed: number } {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 6) return { text, removed: 0 }

  const out: string[] = []
  let removed = 0
  let i = 0
  while (i < words.length) {
    let collapsed = false
    // Smallest period first, so "X X X X X X" collapses to "X" rather than to "X X" (period 2n also matches)
    for (let n = 2; n <= 20; n++) {
      if (i + n * minRepeats > words.length) continue
      const phrase = words.slice(i, i + n).join(' ')
      let repeats = 1
      while (i + (repeats + 1) * n <= words.length && words.slice(i + repeats * n, i + (repeats + 1) * n).join(' ') === phrase) repeats++
      if (repeats >= minRepeats) {
        out.push(...words.slice(i, i + n))
        removed += (repeats - 1) * n
        i += repeats * n
        collapsed = true
        break
      }
    }
    if (!collapsed) {
      out.push(words[i])
      i++
    }
  }
  return { text: out.join(' '), removed }
}

const SCRIPT_RANGES: Array<[string, RegExp]> = [
  ['gu', /[઀-૿]/g],
  ['hi', /[ऀ-ॿ]/g], // Devanagari: Hindi or Marathi — Hindi is far more common in this app
  ['pa', /[਀-੿]/g],
  ['bn', /[ঀ-৿]/g],
  ['ta', /[஀-௿]/g],
  ['te', /[ఀ-౿]/g],
  ['kn', /[ಀ-೿]/g],
  ['ml', /[ഀ-ൿ]/g],
  ['ar', /[؀-ۿ]/g],
  ['en', /[A-Za-z]/g],
]

/**
 * Language from the dominant script of the text — free and deterministic. Used when the STT model
 * does not report a language (gpt-4o-transcribe). Returns undefined when nothing dominates
 * (no letters at all) so the caller can fall back to a model call or a default.
 */
export function detectLanguageByScript(text: string): string | undefined {
  let latin = 0
  let best: { code: string; count: number } | undefined
  for (const [code, re] of SCRIPT_RANGES) {
    const count = (text.match(re) || []).length
    if (code === 'en') latin = count
    else if (count > 0 && (!best || count > best.count)) best = { code, count }
  }
  // English terms are common inside Indic transcripts; Indic words inside English transcripts are not.
  // So a non-Latin script wins as soon as it has a meaningful share of the letters.
  if (best && best.count >= latin * 0.2) return best.code
  if (latin > 0) return 'en'
  return undefined
}
