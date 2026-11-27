import { describe, it, expect } from 'vitest'
import { hasSeekIndex, joinArgs, joinAudioParts, makeSeekable, normalizeParts, partChunkIndexes, remuxArgs } from '@/lib/recording-parts'
import { runFfmpeg } from '@/lib/openai'

describe('normalizeParts', () => {
  it('none / empty → null (single part, all chunks)', () => {
    expect(normalizeParts(undefined, 5)).toBeNull()
    expect(normalizeParts([], 5)).toBeNull()
  })
  it('sorts and accepts gaps (a deleted part)', () => {
    expect(normalizeParts([{ start: 4, end: 6 }, { start: 0, end: 2 }], 6)).toEqual([{ start: 0, end: 2 }, { start: 4, end: 6 }])
  })
  it.each([
    [[{ start: 0, end: 0 }], 'empty part'],
    [[{ start: 0, end: 7 }], 'past the uploaded chunks'],
    [[{ start: 0, end: 3 }, { start: 2, end: 4 }], 'overlap'],
    [[{ start: -1, end: 2 }], 'negative'],
  ])('rejects %j (%s)', (parts) => {
    expect(() => normalizeParts(parts, 6)).toThrow()
  })
})

describe('partChunkIndexes / joinArgs', () => {
  it('expands ranges', () => {
    expect(partChunkIndexes([{ start: 0, end: 2 }, { start: 5, end: 6 }])).toEqual([[0, 1], [5]])
  })
  it('builds a concat filter over every input in order', () => {
    const args = joinArgs(['a.webm', 'b.webm', 'c.webm'], 'out.webm')
    expect(args).toContain('[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]')
    expect(args.filter((a) => a === '-i')).toHaveLength(3)
    expect(args.at(-1)).toBe('out.webm')
  })
})

describe('joinAudioParts (real ffmpeg)', () => {
  it('joins two separate WebM files into one playable file with both durations', async () => {
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'parts-test-'))
    const make = async (name: string, seconds: number) => {
      const file = path.join(dir, name)
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', `sine=f=440:d=${seconds}`, '-c:a', 'libopus', file])
      return fs.promises.readFile(file)
    }
    const joined = await joinAudioParts([await make('a.webm', 2), await make('b.webm', 1)])
    const out = path.join(dir, 'joined.webm')
    await fs.promises.writeFile(out, joined)
    const { execFile } = await import('child_process')
    const ffmpeg = (await import('ffmpeg-static')).default as unknown as string
    const stderr = await new Promise<string>((resolve) => execFile(ffmpeg, ['-i', out, '-f', 'null', '-'], (_e, _o, err) => resolve(String(err))))
    const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)]
    const last = times.at(-1)!
    const seconds = Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
    expect(seconds).toBeGreaterThan(2.8)
    await fs.promises.rm(dir, { recursive: true, force: true })
  }, 30_000)

  it('a single browser-style part (no seek index) is rewrapped so players can skip and scrub', async () => {
    const fs = await import('fs')
    const os = await import('os')
    const path = await import('path')
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'remux-test-'))
    const live = path.join(dir, 'live.webm')
    // -live 1 writes WebM like MediaRecorder: no duration, no Cues
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=f=300:d=40', '-c:a', 'libopus', '-f', 'webm', '-live', '1', live])
    const input = await fs.promises.readFile(live)
    expect(hasSeekIndex(input)).toBe(false)
    const out = await joinAudioParts([input])
    expect(hasSeekIndex(out)).toBe(true)
    expect(Math.abs(out.length - input.length)).toBeLessThan(input.length * 0.05) // copied, not re-encoded
    await fs.promises.rm(dir, { recursive: true, force: true })
  }, 30_000)

  it('keeps a part as is when it already has a seek index or ffmpeg fails', async () => {
    const garbage = Buffer.from('x')
    expect(await makeSeekable(garbage)).toBe(garbage)
    const indexed = Buffer.concat([Buffer.alloc(10), Buffer.from([0x1c, 0x53, 0xbb, 0x6b])])
    expect(await makeSeekable(indexed)).toBe(indexed)
    expect(remuxArgs('a.webm', 'b.webm')).toEqual(['-y', '-i', 'a.webm', '-c', 'copy', '-f', 'webm', 'b.webm'])
  })
})
