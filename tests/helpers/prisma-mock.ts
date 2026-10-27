/**
 * Minimal Prisma mock: every `prisma.<model>.<method>` is a vi.fn() you can program per test.
 * `prisma.$transaction(fn)` runs `fn` with the same mock so transactional code is exercised.
 */
import { vi } from 'vitest'

const MODELS = [
  'user',
  'meeting',
  'todo',
  'department',
  'recurringSchedule',
  'meetingRecording',
  'calendarEvent',
  'attachment',
  'notification',
  'auditLog',
  'systemSettings',
  'session',
  'account',
  'backupHistory',
  'recordingJob',
  'meetingFormRevision',
] as const

const METHODS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findMany',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
] as const

type ModelMock = Record<(typeof METHODS)[number], ReturnType<typeof vi.fn>>
export type PrismaMock = Record<(typeof MODELS)[number], ModelMock> & {
  $transaction: ReturnType<typeof vi.fn>
  $queryRaw: ReturnType<typeof vi.fn>
}

function buildModel(): ModelMock {
  return Object.fromEntries(METHODS.map((m) => [m, vi.fn()])) as ModelMock
}

export const prismaMock = Object.fromEntries(MODELS.map((m) => [m, buildModel()])) as PrismaMock
prismaMock.$transaction = vi.fn()
prismaMock.$queryRaw = vi.fn()

export function resetPrismaMock() {
  for (const model of MODELS) {
    for (const method of METHODS) {
      prismaMock[model][method].mockReset()
      // sensible defaults so un-programmed calls don't explode
      if (method === 'findMany') prismaMock[model][method].mockResolvedValue([])
      else if (method === 'count') prismaMock[model][method].mockResolvedValue(0)
      else if (method === 'deleteMany' || method === 'updateMany' || method === 'createMany')
        prismaMock[model][method].mockResolvedValue({ count: 0 })
      else prismaMock[model][method].mockResolvedValue(null)
    }
  }
  prismaMock.$transaction.mockReset()
  prismaMock.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg as Promise<unknown>[])
  )
  prismaMock.$queryRaw.mockReset()
  prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
}

resetPrismaMock()
