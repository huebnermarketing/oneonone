import { requirePageAdmin } from '@/lib/auth-helpers'
import { SettingsClient } from './settings-client'

export default async function SettingsPage() {
  await requirePageAdmin()

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold text-dark-gray dark:text-white mb-2">
          System Settings
        </h1>
        <p className="text-medium-gray">
          Policies, AI provider, recording storage and data
        </p>
      </div>

      <SettingsClient />
    </div>
  )
}
