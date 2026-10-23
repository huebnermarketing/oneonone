# API Reference (as implemented, commit `a26e431`)

All handlers live under `app/api/**/route.ts`, export `dynamic = 'force-dynamic'`, and return `{ error: string }` on failure unless noted. "Auth" is what the code enforces, not the intent. Roles: `EMPLOYEE`, `REPORTER`, `SUPER_ADMIN` (abbrev. ADMIN). "Participant" = meeting `employeeId` or `reporterId`.

## Auth

| Method | Path | Auth | Body / query | Effect | Response |
|---|---|---|---|---|---|
| GET/POST | `/api/auth/[...nextauth]` | public | NextAuth | Google OAuth flow | NextAuth |
| POST | `/api/auth/test-login` | public; 404 in production unless `ENABLE_TEST_LOGIN=true` | `{role}` | Find/create `test-<role>@test.com`, insert `Session`, set cookie | `{success, user}` |

## Users / Departments (ADMIN only)

| Method | Path | Body / query | Effect | Response |
|---|---|---|---|---|
| GET | `/api/users` | — | All users incl. department, reportsTo (full rows incl. phone, kekaEmployeeId) | `User[]` |
| POST | `/api/users` | `{email*, name, role, departmentId, reportsToId, country, timeZone, workDayStart, workDayEnd}` | Email must end `@whitelabeliq.com`; audit | `User` / 400 dup |
| GET | `/api/users/[id]` | — | — | `User` / 404 |
| PATCH | `/api/users/[id]` | same + `isActive`, `kekaEmployeeId` | Domain + uniqueness, one-level circular-manager check; audit | `User` |
| DELETE | `/api/users/[id]` | — (not self) | Transaction: detach reports, delete user's meetings (+children), todos, schedules, audit logs, user | `{success}` |
| GET | `/api/departments` | — | With `_count.users` | `Department[]` |
| POST | `/api/departments` | `{name}` | audit | `Department` / 400 dup |
| GET/PATCH/DELETE | `/api/departments/[id]` | `{name}` | DELETE nulls users' `departmentId` then deletes (not transactional) | `Department` / `{success}` |

## Meetings

| Method | Path | Auth | Body / query | Effect | Response |
|---|---|---|---|---|---|
| GET | `/api/meetings` | any | `?start&end` ISO | EMPLOYEE: own as employee; REPORTER: as employee or reporter; ADMIN: all | `Meeting[]` with employee/reporter `{id,name,email}` |
| POST | `/api/meetings` | REPORTER, ADMIN | `{employeeId, meetingDate, meetingType, meetingLink}` | ZOOM requires link. Reporter = caller, or employee's manager when caller is ADMIN. 30-min conflict check → 409. Creates `PROPOSED`; proposal email + notif to employee, confirmation email to reporter; audit. No calendar event. | `Meeting` |
| PATCH | `/api/meetings/[id]` | `meeting.reporterId` or ADMIN | `{meetingDate, status:'SCHEDULED'\|'COMPLETED', meetingType, meetingLink}` | `CANCELLED` → 403 always. `COMPLETED` → 400 if `requireFormBeforeComplete` and form not submitted. Date change updates Google event. Audit; `notifyMeetingCompleted`. | `Meeting` |
| DELETE | `/api/meetings/[id]` | ADMIN | — | Delete Google event, hard delete (FK error if todos exist) | `{success}` |
| POST | `/api/meetings/[id]/accept` | receiver (employee if reporter/admin proposed; reporter if employee proposed) or ADMIN | — | `PROPOSED` + future only → `SCHEDULED`. Calendar event (single or 1-yr recurring series) on reporter's calendar if connected. Email + notif to proposer. Recurring: create next occurrence as `SCHEDULED`, advance schedule. Audit. | `Meeting` |
| POST | `/api/meetings/[id]/suggest` | participant or ADMIN | `{meetingDate*}` | `PROPOSED` only. Updates date; receiver suggesting flips `proposedById`. Email + notif to other party. No conflict check. | `Meeting` |
| GET / PATCH | `/api/meetings/[id]/notes` | GET participant/ADMIN; PATCH reporter/ADMIN | `{notes}` | Free-text notes (no type check) | `{notes}` |
| POST | `/api/meetings/[id]/form` | **employee only** (ADMIN cannot) | `{draft?, …10 fields}` | 403 if submitted and meeting time passed. Submit requires 4 fields, sets `formSubmittedAt` once, emails reporter + notif. Status unchanged. | `Meeting` |
| GET | `/api/meetings/[id]/attachments` | participant/ADMIN | `?attachmentId` | List, or signed download URL | `Attachment[]` / `{downloadUrl, fileName}` |
| POST | `/api/meetings/[id]/attachments` | participant/ADMIN | `{fileName*, fileType*, fileSize* ≤10MB}` | Creates row first, then presigned PUT; without S3 returns `skipUpload:true` (orphan row) | `{uploadUrl, attachmentId, skipUpload}` |
| DELETE | `/api/meetings/[id]/attachments` | participant/ADMIN | `?attachmentId*` | S3 delete (best effort) + row. Does not verify attachment belongs to `[id]`. | `{success}` |
| GET | `/api/meetings/[id]/availability` | participant/ADMIN | `?date*` | Mutual free 30-min slots (Google free/busy ∩ work hours) minus DB meetings | `{slots, calendarUnavailable, workingHoursLabel}` |
| GET | `/api/meetings/availability` | REPORTER, ADMIN | `?employeeId*&date?` | No date → calendar-connection status; with date → Keka check + slots. No reports-to check on `employeeId`. | see route |
| GET | `/api/meetings/availability/recurring` | REPORTER, ADMIN | `?employeeId*&dayOfWeek*&timeOfDay*&frequency` | First free of next 6 occurrences (Keka + Google) | `{available, firstDate, …}` |

## Recording (per meeting) — all: REPORTER/ADMIN + `canAccessEmployeeData`

| Method | Path | Body | Effect | Response |
|---|---|---|---|---|
| GET | `/api/meetings/[id]/recording` | — | Row + signed `audioPlaybackUrl` when COMPLETED | `{recording}` |
| DELETE | `/api/meetings/[id]/recording` | — | `deleteS3Prefix` + row delete | `{message}` |
| POST | `/api/meetings/[id]/recording/presign` | — | Upsert `MeetingRecording` UPLOADING with session prefix; 503 without S3; 400 if COMPLETED exists | `{sessionKey}` |
| POST | `/api/meetings/[id]/recording/upload` | multipart `file`, `sequence` | Server-side PutObject `chunk_NNNN.webm`; `fileSize +=` (non-atomic) | `{success, chunkKey, sequence}` |
| POST | `/api/meetings/[id]/recording/process` | `{totalChunks*, duration, language}` | 400 without OpenAI key. Sets UPLOADED, runs `processRecording()` detached: concat → final.webm → Whisper → GPT → COMPLETED/FAILED, notif both | `{message, recordingId}` |
| GET | `/api/meetings/[id]/recording/stream` | — | 302 to signed URL; plain-text errors | redirect |

## Cross-meeting AI (REPORTER = own `reporterId` meetings; ADMIN = all)

| Method | Path | Params | Effect |
|---|---|---|---|
| GET | `/api/recordings/search` | `?q*&departmentId&limit=20` | Up to 100 COMPLETED transcripts → `searchTranscripts` (gpt-4o-mini) |
| POST | `/api/recordings/analyze` | `{question*, departmentId}` | Up to 100 meetings (form + recording) → inline GPT prompt → `{answer, topFindings, examples, recommendations, summary}` |
| GET | `/api/recordings/insights` | `?departmentId&period=30` | Counts, per-dept quality/sentiment/themes, language + sentiment distribution, `generateOrganizationInsights` if ≥3 analysed |

## Recurring schedules

| Method | Path | Auth | Body / query | Effect |
|---|---|---|---|---|
| GET | `/api/recurring-schedules` | any | — | Active schedules where `reporterId = caller` (ADMIN also sees only own) |
| POST | `/api/recurring-schedules` | REPORTER, ADMIN | `{employeeId*, frequency, dayOfWeek*, timeOfDay*, meetingType, meetingLink}` | Rejects duplicates / clashes (400); first free of 6 occurrences else 409. Creates schedule + first meeting `PROPOSED`; email + notif; audit. Caller becomes reporter. |
| GET | `/api/recurring-schedules/[id]` | owner/ADMIN | — | Schedule + last 10 meetings + `upcomingMeetingCount` |
| PATCH | `/api/recurring-schedules/[id]` | owner/ADMIN | `{frequency, dayOfWeek, timeOfDay, isActive, cancelFutureMeetings, meetingType, meetingLink}` | Pause with cancel → cancels future SCHEDULED meetings (+ calendar). Timing change → recompute next date, move future PROPOSED meetings, email + notif. |
| DELETE | `/api/recurring-schedules/[id]` | owner/ADMIN | `?cancelFutureMeetings=true` | Soft delete (`isActive=false`), clear Google series ids, optionally cancel future meetings |

## Todos

| Method | Path | Auth | Body | Effect |
|---|---|---|---|---|
| GET | `/api/todos` | any | — | EMPLOYEE: assigned to self. **REPORTER/ADMIN: every todo in the system** |
| POST | `/api/todos` | any | `{title, description, assignedToId, meetingId, dueDate, priority}` | No participation/existence checks; email + notif if assigned to someone else; audit |
| GET / PATCH | `/api/todos/[id]` | assignee, creator, ADMIN | `{status, priority, dueDate}` | PATCH sets/clears `completedAt`; title not editable |
| DELETE | `/api/todos/[id]` | creator, ADMIN | — | audit |

## Notifications (own rows only)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/notifications` | `?limit=50&offset=0&type&read&countOnly` | `{notifications, unreadCount, total}` / `{count}` |
| POST | `/api/notifications` | `{action:'markAllRead'\|'deleteAllRead'\|'deleteAll'}` | `{success, deleted?}` |
| PATCH / DELETE | `/api/notifications/[id]` | `{isRead}` | `{success}` |

## Reports

| Method | Path | Auth | Query | Effect |
|---|---|---|---|---|
| GET | `/api/reports` | REPORTER (own meetings) / ADMIN | `?departmentId&startDate&endDate&format=csv` | Keyword sentiment, issue categories, trends; CSV option. Todo scope = all active users (dept-filtered), not the reporter's team. |
| GET | `/api/reports/quarterly/[userId]` | `canAccessEmployeeData` | — | Current-quarter meetings + todos, themes, goals, support requests |

## Settings & admin (ADMIN only)

| Method | Path | Body / query | Effect |
|---|---|---|---|
| GET / PUT | `/api/settings` | `{openaiApiKey, openaiModel, whisperModel, awsRegion, awsAccessKeyId, awsSecretKey, awsS3Bucket, maxRecordingMins}` | Masked read; PUT encrypts secrets, audit. `requireFormBeforeComplete` is **not** exposed here. |
| POST | `/api/settings` | `{action:'test-openai'\|'test-s3'}` | Connectivity test |
| GET | `/api/settings/models` | — | OpenAI chat models (curated, max 12) |
| GET / POST | `/api/admin/backup` | `{type='FULL'}` | History / JSON export returned **inline** (users, depts, meetings+todos, recording text). Not written to S3. Omits schedules, notifications, attachments, settings. |
| POST | `/api/admin/restore` | `{data, options:{clearExisting, restoreUsers, restoreMeetings}}` | Transaction with per-row try/catch; roles from file applied unvalidated; recordings not restored |
| GET / POST | `/api/admin/clear-data` | `{clearType:'all'\|'recordings'\|'todos'\|'meetings'\|'users'\|'departments', keepCurrentUser}` | **Non-transactional, no audit log.** Will FK-fail on `AuditLog`/`RecurringSchedule` when clearing users; S3 objects never deleted. |
| POST | `/api/admin/import-users` | `{users:[{name*, email*, role, department, reportsTo, title, phone}]}` | Non-transactional; role aliases TEAM_LEAD/MANAGER→REPORTER, ADMIN→SUPER_ADMIN; auto-creates departments |
| GET | `/api/admin/storage` | — | S3/local flag, local dir stats, recording byte totals |
| GET | `/api/admin/recordings` | — | All recordings flattened, unpaginated |
| GET | `/api/admin/audit-logs` | `?userId&action&entityType&startDate&endDate&limit&offset` | `action` cast unvalidated |

## Misc

| Method | Path | Auth | Effect |
|---|---|---|---|
| GET / PATCH / DELETE | `/api/dashboard/widgets` | any | Per-user widgets (seeded by role); **UI (`dashboard-widgets.tsx`) is not mounted anywhere** |
| POST | `/api/onboarding` | EMPLOYEE/REPORTER | `{departmentId, reportsToId*}` sets own manager/dept |
| GET / PATCH | `/api/profile` | any | Edit own profile incl. `reportsToId` and `departmentId` (user can change their own manager) |
| POST | `/api/cron/meetings` | `x-cron-secret` (open in dev when unset) | Generate recurring occurrences; 24h/1h reminders; form reminders |
| POST | `/api/integrations/fathom/webhook` | HMAC (`FATHOM_WEBHOOK_SECRET`) | Match ZOOM meeting, upsert `MeetingRecording` COMPLETED, notify |
| GET | `/api/health` | public | `SELECT 1` → `{status, timestamp}` 200/503 |

## Validation status

No route uses zod. Routes that accept unvalidated enums/dates/ids and will 500 on bad input: `meetings` POST/PATCH/suggest/notes, `todos` POST/PATCH, `users` POST/PATCH, `departments` POST, `recurring-schedules` POST/PATCH, `settings` PUT, `admin/backup|restore|audit-logs`, `dashboard/widgets` PATCH, `recording/process`, `notifications`/`recordings` pagination params (NaN). See `REFACTOR_BACKLOG.md` §2.
