import { describe, it, expect } from 'vitest'
import {
  buildTranscriptionPrompt,
  collapseRepetitions,
  detectLanguageByScript,
  isGpt4oTranscribe,
  modelSegmentCap,
  preferredResponseFormat,
} from '@/lib/transcription-quality'

describe('buildTranscriptionPrompt', () => {
  it('uses the native script for Gujarati / Hindi / Marathi', () => {
    expect(buildTranscriptionPrompt('gu')).toMatch(/[઀-૿]/)
    expect(buildTranscriptionPrompt('hi')).toMatch(/[ऀ-ॿ]/)
    expect(buildTranscriptionPrompt('mr')).toMatch(/मराठी/)
    expect(buildTranscriptionPrompt('gu')).not.toMatch(/[ऀ-ॿ]/) // no Devanagari leak into the Gujarati primer
  })
  it('falls back to an English primer for unknown codes and a multilingual one for auto', () => {
    expect(buildTranscriptionPrompt('fr')).toMatch(/one-on-one meeting/)
    expect(buildTranscriptionPrompt(undefined)).toMatch(/English, Hindi or Gujarati/)
  })
  it('appends participant names', () => {
    const p = buildTranscriptionPrompt('en', { participantNames: ['Alex Patel', ' ', 'Priya Shah'] })
    expect(p).toMatch(/Participants: Alex Patel, Priya Shah\.$/)
  })
  it('stays under the Whisper prompt budget', () => {
    for (const l of ['gu', 'hi', 'mr', 'en', undefined]) expect(buildTranscriptionPrompt(l, { participantNames: ['A B', 'C D'] }).length).toBeLessThan(600)
  })
})

describe('model traits', () => {
  it('recognises gpt-4o-transcribe family', () => {
    expect(isGpt4oTranscribe('openai/gpt-4o-transcribe')).toBe(true)
    expect(isGpt4oTranscribe('gpt-4o-mini-transcribe')).toBe(true)
    expect(isGpt4oTranscribe('openai/whisper-1')).toBe(false)
  })
  it('asks json directly where verbose_json is known to 400, and caps segments', () => {
    expect(preferredResponseFormat('openai/gpt-4o-transcribe')).toBe('json')
    expect(preferredResponseFormat('whisper-1')).toBe('verbose_json')
    expect(modelSegmentCap('gpt-4o-transcribe')).toBe(23 * 60)
    expect(modelSegmentCap('whisper-1')).toBeUndefined()
  })
})

describe('collapseRepetitions', () => {
  it('collapses a looping phrase to one occurrence', () => {
    const loop = 'આણિ જે પ્રોબ્લમ જે યે પ્રોબ્લમ શોલ કરતી થો'
    const text = `સો તમ્હે મીટિંગ ચાલુ કરો ${Array(6).fill(loop).join(' ')}`
    const r = collapseRepetitions(text)
    expect(r.text).toBe(`સો તમ્હે મીટિંગ ચાલુ કરો ${loop}`)
    expect(r.removed).toBe(5 * loop.split(' ').length)
  })
  it('leaves natural speech alone (two repeats, or repeats separated by other words)', () => {
    const t = 'yes yes I agree, we should ship it and then ship it again next week'
    expect(collapseRepetitions(t)).toEqual({ text: t, removed: 0 })
    const t2 = 'ok ok ok fine' // single-word triples are not touched (n >= 2)
    expect(collapseRepetitions(t2 + ' and more words here')).toEqual({ text: t2 + ' and more words here', removed: 0 })
  })
  it('handles loops in the middle and keeps text after them', () => {
    const r = collapseRepetitions('start here the same thing the same thing the same thing the same thing and then the end')
    expect(r.text).toBe('start here the same thing and then the end')
    expect(r.removed).toBe(9)
  })
  it('short texts pass through; a pure loop collapses to its smallest period', () => {
    expect(collapseRepetitions('a b a b')).toEqual({ text: 'a b a b', removed: 0 })
    expect(collapseRepetitions('a b a b a b a b')).toEqual({ text: 'a b', removed: 6 })
  })
})

describe('detectLanguageByScript', () => {
  it('detects Indic scripts and plain English', () => {
    expect(detectLanguageByScript('આ એક મીટિંગ છે with project deadline')).toBe('gu')
    expect(detectLanguageByScript('यह एक मीटिंग है')).toBe('hi')
    expect(detectLanguageByScript('இது ஒரு சந்திப்பு')).toBe('ta')
    expect(detectLanguageByScript('This is a normal English meeting about the roadmap.')).toBe('en')
  })
  it('prefers the Indic script in code-mixed text, and gives up on no letters', () => {
    expect(detectLanguageByScript('ok ok ok ok project deadline client feedback આ મીટિંગ છે')).toBe('gu')
    expect(detectLanguageByScript('A long English sentence about the roadmap, deadlines and clients with one word: છે')).toBe('en')
    expect(detectLanguageByScript('123 456')).toBeUndefined()
  })
})
