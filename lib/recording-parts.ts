/**
 * Multi-part recordings: the recorder can Stop and "Add another part" any number of times before
 * submitting. All parts share one upload session and one running chunk sequence; each part is a
 * separate MediaRecorder stream, i.e. its own WebM file (own header), so parts can't simply be
 * byte-concatenated like the chunks inside one part — they are decoded and joined with ffmpeg.
 *
 * A part is the half-open chunk range [start, end). Parts deleted in the browser before submitting
 * are simply not listed; their chunks are cleaned up with the rest after combining.
 */
import { badRequest } from './api-errors'
import { runFfmpeg } from './openai'

export interface ChunkRange {
  start: number
  end: number
}

export const MAX_PARTS = 50

/** Validate client-sent parts against the uploaded chunk count. Returns them sorted. */
export function normalizeParts(parts: ChunkRange[] | undefined, totalChunks: number): ChunkRange[] | null {
  if (!parts || parts.length === 0) return null
  if (parts.length > MAX_PARTS) throw badRequest(`A recording can have at most ${MAX_PARTS} parts`)
  const sorted = [...parts].sort((a, b) => a.start - b.start)
  let prevEnd = 0
  for (const p of sorted) {
    if (!Number.isInteger(p.start) || !Number.isInteger(p.end) || p.start < 0 || p.end <= p.start || p.end > totalChunks) {
      throw badRequest('Recording parts do not match the uploaded audio. Record again.')
    }
    if (p.start < prevEnd) throw badRequest('Recording parts overlap. Record again.')
    prevEnd = p.end
  }
  return sorted
}

/** Chunk indexes of each part, in order. */
export const partChunkIndexes = (parts: ChunkRange[]) => parts.map((p) => Array.from({ length: p.end - p.start }, (_, i) => p.start + i))

/** ffmpeg arguments that decode N inputs and join them, in order, into one Opus WebM. */
export function joinArgs(inputs: string[], output: string): string[] {
  const streams = inputs.map((_, i) => `[${i}:a]`).join('')
  return [
    '-y',
    ...inputs.flatMap((f) => ['-i', f]),
    '-filter_complex',
    `${streams}concat=n=${inputs.length}:v=0:a=1[a]`,
    '-map',
    '[a]',
    '-c:a',
    'libopus',
    '-b:a',
    '64k',
    output,
  ]
}

/** Join several WebM parts into one WebM (single part is returned as is). */
export async function joinAudioParts(parts: Buffer[]): Promise<Buffer> {
  if (parts.length === 1) return parts[0]!
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rec-parts-'))
  try {
    const inputs = await Promise.all(
      parts.map(async (buf, i) => {
        const file = path.join(dir, `part_${i}.webm`)
        await fs.promises.writeFile(file, buf)
        return file
      })
    )
    const output = path.join(dir, 'joined.webm')
    await runFfmpeg(joinArgs(inputs, output), 300_000)
    return await fs.promises.readFile(output)
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
