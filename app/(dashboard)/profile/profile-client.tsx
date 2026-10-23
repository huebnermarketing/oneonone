'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { User, Mail, Phone, Briefcase, Building2, Calendar, Save, Loader2, Users, ChevronDown, Globe, Clock } from 'lucide-react'
import { UserRole } from '@prisma/client'
import { useToast } from '@/components/ui/toast'
import {
  COUNTRY_OPTIONS,
  TIMEZONE_OPTIONS,
  getDefaultWorkHoursForCountry,
  getDefaultTimeZoneForCountry,
  DEFAULT_WORK_START,
  DEFAULT_WORK_END,
} from '@/lib/timezones'

interface ProfileUser {
  id: string
  name: string
  email: string
  avatar: string | null
  phone: string | null
  title: string | null
  role: UserRole
  departmentId: string | null
  reportsToId: string | null
  country: string | null
  timeZone: string | null
  workDayStart: string | null
  workDayEnd: string | null
  department: { id: string; name: string } | null
  reportsTo: { id: string; name: string; email: string } | null
  createdAt: string
}

interface ProfileClientProps {
  user: ProfileUser
  departments: { id: string; name: string }[]
  managers: { id: string; name: string; email: string }[]
}

const COUNTRY_CODES = [
  { code: '+91', country: 'IN', label: '🇮🇳 +91' },
  { code: '+1', country: 'US', label: '🇺🇸 +1' },
]

function parsePhone(phone: string | null): { countryCode: string; localNumber: string } {
  if (!phone) return { countryCode: '+91', localNumber: '' }
  const trimmed = phone.trim()
  // Try to match a known country code at the start (longest first)
  const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length)
  for (const cc of sorted) {
    if (trimmed.startsWith(cc.code)) {
      return { countryCode: cc.code, localNumber: trimmed.slice(cc.code.length).trim() }
    }
  }
  // If no code matched but starts with +, keep +91 default and put the whole thing as local
  return { countryCode: '+91', localNumber: trimmed.replace(/^\+/, '') }
}

export function ProfileClient({ user, departments, managers }: ProfileClientProps) {
  const router = useRouter()
  const { toastSuccess, toastError } = useToast()
  const [saving, setSaving] = useState(false)

  const parsed = parsePhone(user.phone)
  const [countryCode, setCountryCode] = useState(parsed.countryCode)
  const [localNumber, setLocalNumber] = useState(parsed.localNumber)

  const combinedPhone = localNumber ? `${countryCode} ${localNumber}` : ''

  const [formData, setFormData] = useState({
    name: user.name,
    phone: user.phone || '',
    title: user.title || '',
    country: user.country || '',
    timeZone: user.timeZone || '',
    workDayStart: user.workDayStart || DEFAULT_WORK_START,
    workDayEnd: user.workDayEnd || DEFAULT_WORK_END,
  })

  const handleSave = async () => {
    if (!formData.name || !formData.name.trim()) {
      toastError('Please enter your full name')
      return
    }
    if (formData.name.trim().length < 2) {
      toastError('Full name must be at least 2 characters')
      return
    }

    if (localNumber) {
      const digitsOnly = localNumber.replace(/\D/g, '')
      if (digitsOnly.length < 10) {
        toastError('Phone number must be at least 10 digits')
        return
      }
    }

    setSaving(true)
    
    try {
      const response = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, phone: combinedPhone }),
      })

      const data = await response.json()

      if (response.ok) {
        toastSuccess('Profile updated successfully!')
        router.refresh()
      } else {
        toastError(data.error || 'Failed to update profile')
      }
    } catch {
      toastError('Failed to update profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const roleLabels: Record<UserRole, string> = {
    EMPLOYEE: 'Employee',
    REPORTER: 'Team Lead / Reporter',
    SUPER_ADMIN: 'Super Admin',
  }

  const hasChanges =
    formData.name !== user.name ||
    combinedPhone !== (user.phone || '') ||
    formData.title !== (user.title || '') ||
    formData.country !== (user.country || '') ||
    formData.timeZone !== (user.timeZone || '') ||
    formData.workDayStart !== (user.workDayStart || DEFAULT_WORK_START) ||
    formData.workDayEnd !== (user.workDayEnd || DEFAULT_WORK_END)

  const handleCountryChange = (value: string) => {
    const next = { ...formData, country: value }
    if (!formData.timeZone || formData.timeZone === getDefaultTimeZoneForCountry(formData.country || null)) {
      next.timeZone = getDefaultTimeZoneForCountry(value || null)
    }
    if (
      (formData.workDayStart === (user.workDayStart || DEFAULT_WORK_START) || formData.workDayStart === getDefaultWorkHoursForCountry(formData.country || null).start) &&
      (formData.workDayEnd === (user.workDayEnd || DEFAULT_WORK_END) || formData.workDayEnd === getDefaultWorkHoursForCountry(formData.country || null).end)
    ) {
      const def = getDefaultWorkHoursForCountry(value || null)
      next.workDayStart = def.start
      next.workDayEnd = def.end
    }
    setFormData(next)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-dark-gray dark:text-white mb-1">My Profile</h1>
        <p className="text-sm sm:text-base text-medium-gray">Manage your personal information</p>
      </div>

      {/* Profile Card */}
      <div className="rounded-2xl bg-white dark:bg-charcoal border border-off-white dark:border-medium-gray/20 overflow-hidden">
        {/* Header with avatar */}
        <div className="relative h-28 sm:h-32 bg-gradient-to-r from-charcoal to-dark-gray">
          <div className="absolute -bottom-10 sm:-bottom-12 left-4 sm:left-6">
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br from-charcoal to-medium-gray dark:from-medium-gray dark:to-charcoal border-4 border-white dark:border-dark-gray flex items-center justify-center text-white text-2xl sm:text-3xl font-bold cursor-not-allowed"
              title="Profile image cannot be changed"
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          </div>
        </div>

        <div className="pt-14 sm:pt-16 p-4 sm:p-6">
          {/* Read-only info */}
          <div className="mb-6 grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2">
            <div className="rounded-xl bg-off-white dark:bg-dark-gray p-3 sm:p-4 cursor-not-allowed" title="Email cannot be changed">
              <div className="flex items-center gap-2 text-medium-gray mb-1">
                <Mail className="w-4 h-4" />
                <span className="text-xs font-medium">Email</span>
              </div>
              <p className="text-dark-gray dark:text-white font-medium text-sm sm:text-base truncate">{user.email}</p>
            </div>

            <div className="rounded-xl bg-off-white dark:bg-dark-gray p-3 sm:p-4 cursor-not-allowed" title="Role cannot be changed">
              <div className="flex items-center gap-2 text-medium-gray mb-1">
                <User className="w-4 h-4" />
                <span className="text-xs font-medium">Role</span>
              </div>
              <p className="text-dark-gray dark:text-white font-medium text-sm sm:text-base">{roleLabels[user.role]}</p>
            </div>

            <div className="rounded-xl bg-off-white dark:bg-dark-gray p-3 sm:p-4 cursor-not-allowed" title="Member since date cannot be changed">
              <div className="flex items-center gap-2 text-medium-gray mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-xs font-medium">Member Since</span>
              </div>
              <p className="text-dark-gray dark:text-white font-medium text-sm sm:text-base">
                {new Date(user.createdAt).toLocaleDateString('en-US', { 
                  month: 'long', 
                  year: 'numeric' 
                })}
              </p>
            </div>
          </div>

          {/* Editable fields */}
          <div className="space-y-4">
            <h3 className="font-semibold text-dark-gray dark:text-white">Edit Information</h3>
            
            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                Full Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow"
                aria-label="Full name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-medium-gray" />
                  Phone Number
                </div>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-shrink-0">
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="h-full w-[100px] sm:w-[110px] px-2.5 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow appearance-none pr-7 text-sm"
                    aria-label="Country code"
                  >
                    {COUNTRY_CODES.map((cc) => (
                      <option key={cc.code} value={cc.code}>
                        {cc.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-medium-gray pointer-events-none" />
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={localNumber}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9 ]/g, '')
                    setLocalNumber(val)
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key.length === 1 &&
                      !/[0-9 ]/.test(e.key) &&
                      !e.ctrlKey && !e.metaKey
                    ) {
                      e.preventDefault()
                    }
                  }}
                  placeholder="98765 43210"
                  maxLength={12}
                  className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow"
                  aria-label="Phone number"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                <div className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-medium-gray" />
                  Job Title
                </div>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Senior Developer"
                className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow"
                aria-label="Job title"
              />
            </div>

            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-medium-gray" />
                    Department
                  </div>
                </label>
                <div className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white/60 dark:bg-dark-gray/60 text-dark-gray dark:text-white">
                  {departments.find((d) => d.id === user.departmentId)?.name || 'No department'}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-medium-gray" />
                    Reporting Manager
                  </div>
                </label>
                <div className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-off-white/60 dark:bg-dark-gray/60 text-dark-gray dark:text-white">
                  {(() => {
                    const mgr = managers.find((m) => m.id === user.reportsToId)
                    return mgr ? `${mgr.name} (${mgr.email})` : 'No reporting manager'
                  })()}
                </div>
              </div>
              <p className="sm:col-span-2 text-xs text-medium-gray">
                Department and reporting manager are managed by an admin. Contact them if this is wrong.
              </p>
            </div>

            <div className="border-t border-off-white dark:border-medium-gray/20 pt-4 mt-4">
              <h3 className="font-semibold text-dark-gray dark:text-white mb-3 flex items-center gap-2">
                <Globe className="w-4 h-4 text-medium-gray" />
                Location & working hours
              </h3>
              <p className="text-sm text-medium-gray mb-4">
                Used so others can see when you’re available for meetings (e.g. 1:1s) in your timezone.
              </p>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">Country</label>
                  <div className="relative">
                    <select
                      value={formData.country}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow appearance-none pr-10"
                      aria-label="Country"
                    >
                      <option value="">Select country</option>
                      {COUNTRY_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">Time zone</label>
                  <div className="relative">
                    <select
                      value={formData.timeZone}
                      onChange={(e) => setFormData({ ...formData, timeZone: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow appearance-none pr-10"
                      aria-label="Time zone"
                    >
                      <option value="">Select time zone</option>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-medium-gray pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-medium-gray" />
                    Work day start (your local time)
                  </label>
                  <input
                    type="time"
                    value={formData.workDayStart}
                    onChange={(e) => setFormData({ ...formData, workDayStart: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow"
                    aria-label="Work day start"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-medium-gray" />
                    Work day end (your local time)
                  </label>
                  <input
                    type="time"
                    value={formData.workDayEnd}
                    onChange={(e) => setFormData({ ...formData, workDayEnd: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-dark-gray text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50 transition-shadow"
                    aria-label="Work day end"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || !hasChanges}
                className="flex items-center gap-2 px-6 py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-40 transition-colors min-h-[44px] focus-visible:ring-2 focus-visible:ring-orange/50 focus-visible:outline-none"
                aria-label="Save profile changes"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-5 h-5" />
                    Save Changes
                  </>
                )}
              </button>
              {hasChanges && (
                <span className="text-xs text-medium-gray">You have unsaved changes</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
