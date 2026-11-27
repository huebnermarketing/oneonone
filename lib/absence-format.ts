/**
 * Client-safe labels for Keka absences on meetings (data comes from lib/absences.ts on the server).
 */
export type AbsenceKind = 'holiday' | 'leave' | 'pending'

export interface AbsenceInfo {
  kind: AbsenceKind
  half?: 'FIRST' | 'SECOND'
}

export interface MeetingAbsenceInfo {
  employee?: AbsenceInfo
  reporter?: AbsenceInfo
}

/** Short chip label. */
export function absenceLabel(a: AbsenceInfo): string {
  if (a.kind === 'holiday') return 'Holiday'
  if (a.kind === 'pending') return 'Leave pending'
  return a.half ? 'Half-day leave' : 'On leave'
}

export interface AbsenceChipData extends AbsenceInfo {
  label: string
}

/**
 * Chips to show on a meeting for this viewer: the other participant's absence (shown next to their name),
 * and — when the viewer is neither participant (admin) — the manager's too, prefixed "Manager:".
 * The viewer's own absence is shown as "You:".
 */
export function absenceChips(
  absence: MeetingAbsenceInfo | undefined,
  meeting: { employeeId: string; reporterId: string },
  viewerId: string
): AbsenceChipData[] {
  if (!absence) return []
  const chips: AbsenceChipData[] = []
  const add = (a: AbsenceInfo | undefined, prefix = '') => {
    if (a) chips.push({ ...a, label: `${prefix}${absenceLabel(a)}` })
  }
  if (viewerId === meeting.employeeId) {
    add(absence.reporter)
    add(absence.employee, 'You: ')
  } else if (viewerId === meeting.reporterId) {
    add(absence.employee)
    add(absence.reporter, 'You: ')
  } else {
    add(absence.employee)
    add(absence.reporter, 'Manager: ')
  }
  return chips
}
