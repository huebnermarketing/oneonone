/**
 * One-time fix for recordings saved before audio was made seekable (lib/recording-parts.ts makeSeekable):
 * browser recordings had no duration / seek index, so players couldn't skip or scrub. Rewraps each stored
 * final.webm losslessly (no re-encode) and uploads it back to the same S3 key.
 *
 *   npm run recordings:remux             # fix every recording that needs it
 *   npm run recordings:remux -- --check  # report only
 *
 * Idempotent: files that already have a seek index are skipped. Prints counts only (no names).
 */
import { PrismaClient } from '@prisma/client'
import { downloadFromS3, uploadToS3 } from '../lib/s3'
import { hasSeekIndex, makeSeekable } from '../lib/recording-parts'

async function main() {
  const check = process.argv.includes('--check')
  const prisma = new PrismaClient()
  const recordings = await prisma.meetingRecording.findMany({
    where: { audioKey: { endsWith: '/final.webm' } },
    select: { id: true, audioKey: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`${recordings.length} stored recordings${check ? ' (check only)' : ''}`)

  let fixed = 0
  let ok = 0
  let failed = 0
  for (const [i, r] of recordings.entries()) {
    const n = `[${i + 1}/${recordings.length}]`
    try {
      const audio = await downloadFromS3(r.audioKey!)
      if (hasSeekIndex(audio)) {
        ok++
        continue
      }
      if (check) {
        console.log(`${n} needs fixing (${(audio.length / 1048576).toFixed(1)} MB)`)
        fixed++
        continue
      }
      const out = await makeSeekable(audio)
      if (!hasSeekIndex(out)) throw new Error('rewrap did not produce a seek index')
      await uploadToS3(out, r.audioKey!, 'audio/webm')
      await prisma.meetingRecording.update({ where: { id: r.id }, data: { fileSize: out.length } })
      fixed++
      console.log(`${n} fixed (${(audio.length / 1048576).toFixed(1)} MB)`)
    } catch (err) {
      failed++
      console.log(`${n} failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  console.log(`\nAlready seekable: ${ok}  ${check ? 'Need fixing' : 'Fixed'}: ${fixed}  Failed: ${failed}`)
  await prisma.$disconnect()
  if (failed > 0) process.exitCode = 1
}

main()
