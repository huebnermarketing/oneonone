/** Import CSV columns and their help text. Client-safe (no server imports) — used by the import dialog. */

export const IMPORT_COLUMNS = [
  'email',
  'first_name',
  'last_name',
  'role',
  'department',
  'manager_email',
  'job_title',
  'phone',
  'country',
  'time_zone',
  'work_start',
  'work_end',
  'keka_employee_id',
  'status',
] as const
export type ImportColumn = (typeof IMPORT_COLUMNS)[number]

/** What each column accepts — shown in the import dialog. */
export const COLUMN_HELP: Record<ImportColumn, { required?: string; accepts: string }> = {
  email: { required: 'always', accepts: 'Company email. Matches existing users; new emails are created.' },
  first_name: { required: 'new users', accepts: 'Text' },
  last_name: { accepts: 'Text' },
  role: { accepts: 'Employee, Manager (Reporter, Team Lead) or Admin. New users default to Employee.' },
  department: { accepts: 'Any name. Created automatically if it does not exist.' },
  manager_email: { accepts: 'Email of the person they report to (in this file or already in the system).' },
  job_title: { accepts: 'Text' },
  phone: { accepts: 'At least 10 digits' },
  country: { accepts: 'India, United States, Singapore, United Kingdom, Australia, Other (or IN, US, SG, UK, AU)' },
  time_zone: { accepts: 'IST, EST, CST, MST, PST, SGT, GMT, AEST or a zone like Asia/Kolkata. Blank → from country.' },
  work_start: { accepts: '11:00 or 11:00 AM. Blank → from country.' },
  work_end: { accepts: '21:00 or 9:00 PM. Blank → from country.' },
  keka_employee_id: { accepts: 'Keka employee ID (for leave and holidays)' },
  status: { accepts: 'Active or Inactive. Inactive users cannot sign in.' },
}

