'use client'

import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import '@/lib/zod-messages'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const draftSchema = z.object({
  checkInPersonal: z.string().optional(),
  checkInProfessional: z.string().optional(),
  priorityGoalProfessional: z.string().optional(),
  priorityGoalAgency: z.string().optional(),
  progressReport: z.string().optional(),
  goodNews: z.string().optional(),
  supportNeeded: z.string().optional(),
  priorityDiscussions: z.string().optional(),
  headsUp: z.string().optional(),
  anythingElse: z.string().optional(),
})

/** Every question must be answered to submit (drafts can be partial) — same rule as lib/form-fields.ts on the server. */
const REQUIRED_FIELDS: { key: keyof FormData; label: string }[] = [
  { key: 'checkInPersonal', label: 'Personal best since we last met' },
  { key: 'checkInProfessional', label: 'Professional best since we last met' },
  { key: 'priorityGoalProfessional', label: 'Professional growth goals' },
  { key: 'priorityGoalAgency', label: 'Agency growth goals' },
  { key: 'progressReport', label: 'Report on progress' },
  { key: 'goodNews', label: 'Good news to report' },
  { key: 'supportNeeded', label: 'Support I need' },
  { key: 'priorityDiscussions', label: 'Priority issues to discuss' },
  { key: 'headsUp', label: 'Client or internal issues' },
  { key: 'anythingElse', label: 'Anything else' },
]

type FormData = z.infer<typeof draftSchema>

interface OneOnOneFormProps {
  onSubmit: (data: FormData) => Promise<void>
  onSaveDraft?: (data: FormData) => Promise<void>
  initialData?: Partial<FormData>
  isLoading?: boolean
  isReadOnly?: boolean
  draftSaved?: boolean
  /** Submit button text (default "Submit Form") */
  submitLabel?: string
}

export function OneOnOneForm({
  onSubmit,
  onSaveDraft,
  initialData,
  isLoading,
  isReadOnly = false,
  draftSaved = false,
  submitLabel = 'Submit Form',
}: OneOnOneFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    getValues,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(draftSchema),
    defaultValues: initialData,
  })

  const validateRequiredFields = (): boolean => {
    const values = getValues()
    let valid = true
    for (const { key, label } of REQUIRED_FIELDS) {
      if (!values[key]?.trim()) {
        setError(key, { type: 'required', message: `${label} is required` })
        valid = false
      } else {
        clearErrors(key)
      }
    }
    return valid
  }

  const handleFormSubmit = async (data: FormData) => {
    if (!validateRequiredFields()) return
    await onSubmit(data)
  }

  const inputClass = isReadOnly
    ? 'w-full rounded-xl border border-light-gray dark:border-medium-gray bg-gray-100 dark:bg-charcoal/80 px-4 py-3 text-dark-gray dark:text-white cursor-not-allowed'
    : 'w-full rounded-xl border border-light-gray dark:border-medium-gray bg-white dark:bg-charcoal px-4 py-3 text-dark-gray dark:text-white placeholder:text-medium-gray focus:border-orange focus:outline-none focus:ring-2 focus:ring-orange/20 transition-colors'

  return (
    <form
      onSubmit={isReadOnly ? (e) => e.preventDefault() : handleSubmit(handleFormSubmit)}
      className="space-y-8"
    >
      {/* Page 1 */}
      <Card>
        <CardHeader>
          <CardTitle>Check-In</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Personal best since we last met <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('checkInPersonal')}
              rows={4}
              className={`${inputClass} ${errors.checkInPersonal ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
              placeholder="Share your personal highlights..."
              disabled={isReadOnly}
            />
            {errors.checkInPersonal && (
              <p className="mt-1.5 text-sm text-red-500">{errors.checkInPersonal.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Professional best since we last met <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('checkInProfessional')}
              rows={4}
              className={`${inputClass} ${errors.checkInProfessional ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
              placeholder="Share your professional highlights..."
              disabled={isReadOnly}
            />
            {errors.checkInProfessional && (
              <p className="mt-1.5 text-sm text-red-500">{errors.checkInProfessional.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Priority Issues / Growth Goals for This Quarter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              To serve your professional growth <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('priorityGoalProfessional')}
              rows={4}
              className={`${inputClass} ${errors.priorityGoalProfessional ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
              placeholder="What are your professional growth goals for this quarter?"
              disabled={isReadOnly}
            />
            {errors.priorityGoalProfessional && (
              <p className="mt-1.5 text-sm text-red-500">{errors.priorityGoalProfessional.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              To serve the agency growth <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('priorityGoalAgency')}
              rows={4}
              className={inputClass}
              placeholder="What are your goals to help the agency grow?"
              disabled={isReadOnly}
            />
            {errors.priorityGoalAgency && (
              <p className="mt-1.5 text-sm text-red-500">{errors.priorityGoalAgency.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Report on progress of these issues/goals <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('progressReport')}
              rows={5}
              className={`${inputClass} ${errors.progressReport ? '!border-red-500 focus:!ring-red-500/20' : ''}`}
              placeholder="How are you progressing on these goals?"
              disabled={isReadOnly}
            />
            {errors.progressReport && (
              <p className="mt-1.5 text-sm text-red-500">{errors.progressReport.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Good News</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Good news to report <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('goodNews')}
              rows={4}
              className={inputClass}
              placeholder="Share any good news or wins..."
              disabled={isReadOnly}
            />
            {errors.goodNews && (
              <p className="mt-1.5 text-sm text-red-500">{errors.goodNews.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Page 2 */}
      <Card>
        <CardHeader>
          <CardTitle>Support & Discussion</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Support I need to do my job <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('supportNeeded')}
              rows={4}
              className={inputClass}
              placeholder="What support or resources do you need?"
              disabled={isReadOnly}
            />
            {errors.supportNeeded && (
              <p className="mt-1.5 text-sm text-red-500">{errors.supportNeeded.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Priority issues to discuss / questions that need answers / input <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('priorityDiscussions')}
              rows={4}
              className={inputClass}
              placeholder="What topics would you like to discuss?"
              disabled={isReadOnly}
            />
            {errors.priorityDiscussions && (
              <p className="mt-1.5 text-sm text-red-500">{errors.priorityDiscussions.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Heads Up</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Client or internal issues <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('headsUp')}
              rows={4}
              className={inputClass}
              placeholder="Any issues or concerns to flag?"
              disabled={isReadOnly}
            />
            {errors.headsUp && (
              <p className="mt-1.5 text-sm text-red-500">{errors.headsUp.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Additional Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div>
            <label className="block text-sm font-medium text-dark-gray dark:text-white mb-2">
              Anything else? <span className="text-red-500">*</span>
            </label>
            <textarea
              {...register('anythingElse')}
              rows={4}
              className={inputClass}
              placeholder="Any other thoughts or comments?"
              disabled={isReadOnly}
            />
            {errors.anythingElse && (
              <p className="mt-1.5 text-sm text-red-500">{errors.anythingElse.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {!isReadOnly && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {draftSaved && (
            <span className="text-sm text-green-600 dark:text-green-400">Draft saved. You can finish later.</span>
          )}
          {onSaveDraft && (
            <Button
              type="button"
              variant="secondary"
              disabled={isLoading}
              onClick={() => void handleSubmit(onSaveDraft)()}
            >
              {isLoading ? 'Saving...' : 'Save draft'}
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={isLoading}>
            {isLoading ? 'Saving...' : submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
