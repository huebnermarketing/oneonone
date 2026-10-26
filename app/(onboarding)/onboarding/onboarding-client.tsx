'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { User, Building2, ChevronRight, Loader2, CheckCircle2, Search } from 'lucide-react'
import { UserRole } from '@prisma/client'

interface Manager {
  id: string
  name: string
  email: string
  role: UserRole
  departmentId: string | null
  department: string | null
}

interface Department {
  id: string
  name: string
}

interface OnboardingClientProps {
  user: {
    id: string
    name: string
    email: string
    departmentId: string | null
  }
  managers: Manager[]
  departments: Department[]
}

export function OnboardingClient({ user, managers, departments }: OnboardingClientProps) {
  const router = useRouter()
  const [step, setStep] = useState<'department' | 'manager'>(user.departmentId ? 'manager' : 'department')
  const [selectedDepartment, setSelectedDepartment] = useState<string>(user.departmentId || '')
  const [selectedManager, setSelectedManager] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filteredManagers = managers.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          m.email.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesSearch
  })

  const handleDepartmentNext = () => {
    if (!selectedDepartment) {
      setError('Please select your department')
      return
    }
    setError(null)
    setStep('manager')
  }

  const handleComplete = async () => {
    if (!selectedManager) {
      setError('Please select your reporting manager')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId: selectedDepartment || null,
          reportsToId: selectedManager,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      // Redirect to dashboard
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-xl">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-dark-gray dark:bg-white rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-white dark:text-dark-gray" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-dark-gray dark:text-white mb-2">
          Welcome, {user.name}!
        </h1>
        <p className="text-medium-gray">
          Set up your profile to get started
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-4 mb-8">
        <div className={`flex items-center gap-2 ${step === 'department' ? 'text-dark-gray dark:text-white' : 'text-green-500'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            step === 'department' 
              ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray' 
              : 'bg-green-500 text-white'
          }`}>
            {step === 'manager' ? <CheckCircle2 className="w-5 h-5" /> : '1'}
          </div>
          <span className="text-sm font-medium hidden sm:block">Department</span>
        </div>
        
        <div className="w-12 h-0.5 bg-off-white dark:bg-medium-gray/30" />
        
        <div className={`flex items-center gap-2 ${step === 'manager' ? 'text-dark-gray dark:text-white' : 'text-medium-gray'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            step === 'manager' 
              ? 'bg-dark-gray dark:bg-white text-white dark:text-dark-gray' 
              : 'bg-off-white dark:bg-medium-gray/30 text-medium-gray'
          }`}>
            2
          </div>
          <span className="text-sm font-medium hidden sm:block">Manager</span>
        </div>
      </div>

      {/* Card */}
      <div className="bg-white dark:bg-charcoal rounded-2xl border border-off-white dark:border-medium-gray/20 shadow-lg overflow-hidden">
        {/* Department Step */}
        {step === 'department' && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-off-white dark:bg-dark-gray flex items-center justify-center">
                <Building2 className="w-5 h-5 text-dark-gray dark:text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-dark-gray dark:text-white">Select Your Department</h2>
                <p className="text-sm text-medium-gray">Which team do you belong to?</p>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {departments.length === 0 ? (
                <p className="text-center py-8 text-medium-gray">
                  No departments available. Please contact admin.
                </p>
              ) : (
                departments.map((dept) => (
                  <button
                    key={dept.id}
                    onClick={() => setSelectedDepartment(dept.id)}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      selectedDepartment === dept.id
                        ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5'
                        : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-dark-gray dark:text-white">{dept.name}</span>
                      {selectedDepartment === dept.id && (
                        <CheckCircle2 className="w-5 h-5 text-dark-gray dark:text-white" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <button
              onClick={handleDepartmentNext}
              disabled={!selectedDepartment}
              className="w-full mt-6 flex items-center justify-center gap-2 px-6 py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Continue
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Manager Step */}
        {step === 'manager' && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <User className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h2 className="font-semibold text-dark-gray dark:text-white">Select Your Reporting Manager</h2>
                <p className="text-sm text-medium-gray">Who conducts your one-on-one meetings?</p>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <p className="text-sm text-red-500">{error}</p>
              </div>
            )}

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-medium-gray" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 rounded-xl border border-off-white dark:border-medium-gray/20 bg-white dark:bg-charcoal text-dark-gray dark:text-white focus:outline-none focus:ring-2 focus:ring-orange/50"
              />
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {filteredManagers.length === 0 ? (
                <p className="text-center py-8 text-medium-gray">
                  {searchQuery ? 'No managers found matching your search.' : 'No managers available.'}
                </p>
              ) : (
                filteredManagers.map((manager) => (
                  <button
                    key={manager.id}
                    onClick={() => setSelectedManager(manager.id)}
                    className={`w-full p-4 rounded-xl border text-left transition-all ${
                      selectedManager === manager.id
                        ? 'border-dark-gray dark:border-white bg-dark-gray/5 dark:bg-white/5'
                        : 'border-off-white dark:border-medium-gray/20 hover:border-medium-gray/50'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-dark-gray dark:bg-white flex items-center justify-center text-white dark:text-dark-gray font-semibold">
                        {manager.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-dark-gray dark:text-white truncate">
                            {manager.name}
                          </span>
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                            manager.role === UserRole.SUPER_ADMIN
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-blue-500/10 text-blue-500'
                          }`}>
                            {manager.role === UserRole.SUPER_ADMIN ? 'Admin' : 'Team Lead'}
                          </span>
                        </div>
                        <p className="text-sm text-medium-gray truncate">{manager.email}</p>
                        {manager.department && (
                          <p className="text-xs text-medium-gray">{manager.department}</p>
                        )}
                      </div>
                      {selectedManager === manager.id && (
                        <CheckCircle2 className="w-5 h-5 text-dark-gray dark:text-white flex-shrink-0" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep('department')}
                className="px-6 py-3 border border-off-white dark:border-medium-gray/20 text-dark-gray dark:text-white rounded-xl font-medium hover:bg-off-white dark:hover:bg-charcoal transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleComplete}
                disabled={!selectedManager || saving}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-dark-gray dark:bg-white text-white dark:text-dark-gray rounded-xl font-medium hover:bg-charcoal dark:hover:bg-off-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <CheckCircle2 className="w-5 h-5" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Skip option for users who might need admin help */}
      <p className="text-center text-sm text-medium-gray mt-6">
        Cannot find your manager? Contact your administrator to be added to a department.
      </p>
    </div>
  )
}
