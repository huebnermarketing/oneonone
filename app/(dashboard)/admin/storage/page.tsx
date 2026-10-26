import { requirePageAdmin } from '@/lib/auth-helpers'
import { StorageClient } from './storage-client'

export default async function StoragePage() {
  await requirePageAdmin()
  return <StorageClient />
}
