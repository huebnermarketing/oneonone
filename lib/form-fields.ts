/**
 * The employee check-in form's answer fields (client-safe): order, display titles and which are
 * required on submit. Shared by the form API, the meeting page and the answer history.
 */
export const FORM_FIELDS = [
  { key: 'checkInPersonal', title: 'Check-In: Personal Best', required: true },
  { key: 'checkInProfessional', title: 'Check-In: Professional Best', required: true },
  { key: 'priorityGoalProfessional', title: 'Priority Goal: Professional Growth', required: true },
  { key: 'priorityGoalAgency', title: 'Priority Goal: Agency Growth', required: false },
  { key: 'progressReport', title: 'Progress Report', required: true },
  { key: 'goodNews', title: 'Good News', required: false },
  { key: 'supportNeeded', title: 'Support Needed', required: false },
  { key: 'priorityDiscussions', title: 'Priority Discussions', required: false },
  { key: 'headsUp', title: 'Heads Up', required: false },
  { key: 'anythingElse', title: 'Anything Else', required: false },
] as const

export type FormFieldKey = (typeof FORM_FIELDS)[number]['key']
export type FormAnswers = Record<FormFieldKey, string | null>

export interface FormAnswerChange {
  field: FormFieldKey
  before: string | null
  after: string | null
}

export const formFieldTitle = (key: string) => FORM_FIELDS.find((f) => f.key === key)?.title ?? key

/** Empty / whitespace → null so "" and null never count as a change. */
const norm = (v: string | null | undefined) => (v && v.trim() ? v : null)

/** Fields whose answer differs between two versions, in form order. */
export function diffAnswers(before: Partial<FormAnswers>, after: Partial<FormAnswers>): FormAnswerChange[] {
  return FORM_FIELDS.filter((f) => norm(before[f.key]) !== norm(after[f.key])).map((f) => ({
    field: f.key,
    before: norm(before[f.key]),
    after: norm(after[f.key]),
  }))
}

/** Titles of required fields that are empty. */
export const missingRequired = (answers: Partial<FormAnswers>) => FORM_FIELDS.filter((f) => f.required && !norm(answers[f.key])).map((f) => f.title)

export const pickAnswers = (row: Partial<Record<FormFieldKey, string | null>>): FormAnswers =>
  Object.fromEntries(FORM_FIELDS.map((f) => [f.key, norm(row[f.key])])) as FormAnswers
