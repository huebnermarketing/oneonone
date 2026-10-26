# AMI One-on-One — Developer Guide

Internal app for running bi-weekly 1:1s (AMI "Agency Advantage" format): propose/accept meetings, employee check-in form, to-dos, browser audio recording with Whisper transcription + GPT analysis, Google Calendar sync, email + in-app notifications, reports/insights.

This guide is the entry point for anyone picking up the codebase. Companion docs: `docs/API_REFERENCE.md` (every route), `docs/REFACTOR_BACKLOG.md` (known issues, prioritized), `docs/ENV_VARIABLES.md`, `docs/KEKA_INTEGRATION.md`, `docs/FATHOM_ZOOM_SETUP.md`, `docs/RECORDING_OPTIONS.md`.

Baseline: `npm run check` (typecheck + lint + 106 unit tests) clean, `next build` clean, `npm run test:smoke` 42/42 against a seeded dev server. CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests, build, and a migration-drift check on every PR to `stage`/`main`. 19 npm audit findings remain — all need major upgrades (next 16, tailwind 4, nodemailer 10, googleapis 188, eslint-config-next 16), tracked in the backlog.

---

## 1. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript 5 (strict); Turbopack for dev, webpack for production builds; Node ≥ 20.9 | All API routes export `dynamic = 'force-dynamic'` |
| DB / ORM | PostgreSQL + Prisma 5.19 | Migrations in `prisma/migrations/` (baseline `0_init`); `deploy.sh` runs `migrate deploy`. Databases created earlier with `db push` need a one-time `prisma migrate resolve --applied 0_init` |
| Auth | NextAuth 4, Google provider only, `PrismaAdapter`, database sessions (30d) | Requests `calendar` scope at sign-in |
| Styling | Tailwind 3.4, class-based dark mode, lucide-react icons | Brand tokens in `tailwind.config.ts` (`orange #F37022`, `charcoal`, `dark-gray`, `medium-gray`, `light-gray`, `off-white`) |
| Forms / validation | react-hook-form + zod in 2 components, otherwise `useState` + `fetch` | Every API route validates body/query with zod schemas in `lib/validation/*.ts` |
| AI | `openai` SDK v6 against a selectable provider (`lib/ai.ts`): **OpenAI** or **OpenRouter** (one key for OpenAI/Anthropic/Google/… incl. Whisper). Three models chosen in Admin → Settings: analysis, fast (search), transcription | ffmpeg (`ffmpeg-static`) compresses and segments audio (>24 MB, or >10 min on OpenRouter because of its 60 s per-request limit) |
| Storage | AWS S3 (recordings, attachments) | Local `uploads/` fallback exists in `lib/s3.ts` but is **not wired** — recording returns 503 without S3 |
| Email | nodemailer SMTP (preferred) → AWS SES (fallback) | Env-only config; 11 HTML templates in `lib/email.ts` |
| Calendar | googleapis v144 | Per-user OAuth token from `Account` table; Google Meet link auto-added |
| HR / meetings | Keka (leave + holidays), Fathom webhook (transcripts for Zoom meetings) | Both optional, env-gated |
| Hosting | **PM2 on a single EC2 box behind Nginx** (`deploy.sh`, `ecosystem.config.cjs`, `deploy/nginx-ssl.conf`) | `DEPLOYMENT.md` documents this path; the old Docker/ECS files were removed |

---

## 2. Local setup (verified on macOS, Node 24, Postgres 14)

```bash
cd oneonone
createdb ami_oneonone                      # local Postgres, no password for your OS user
cp env.example .env                        # Prisma CLI only reads .env (not .env.local)
# edit .env — minimum:
#   DATABASE_URL="postgresql://<you>@localhost:5432/ami_oneonone?schema=public"
#   NEXTAUTH_SECRET="$(openssl rand -base64 32)"
#   NEXTAUTH_URL="http://localhost:3000"
#   NODE_ENV="development"
#   GOOGLE_CLIENT_ID="placeholder.apps.googleusercontent.com"   # lib/auth.ts throws at boot if empty
#   GOOGLE_CLIENT_SECRET="placeholder"
#   GOOGLE_WORKSPACE_DOMAIN="whitelabeliq.com"
#   INITIAL_ADMIN_EMAILS="you@whitelabeliq.com"      # promoted to SUPER_ADMIN on Google sign-in
npm install
npx prisma generate
npx prisma migrate dev                     # applies prisma/migrations (fresh DB) — or `migrate resolve --applied 0_init` on a db-pushed DB
npm run db:seed                            # WIPES data, creates 6 depts / 27 users / 23 meetings / 30 todos / 3 recordings
npm run dev                                # http://localhost:3000
```

### Logging in locally without Google OAuth

`POST /api/auth/test-login` (dev-only; `NODE_ENV=production` returns 404 unless `ENABLE_TEST_LOGIN=true`) creates a `test-<role>@test.com` user and sets a real NextAuth session cookie. From the browser console on `/auth/signin`:

```js
fetch('/api/auth/test-login', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'SUPER_ADMIN' }) })   // or 'REPORTER' | 'EMPLOYEE'
  .then(() => (location.href = '/dashboard'))
```

Or with curl: `curl -c c.txt -X POST localhost:3000/api/auth/test-login -H 'content-type: application/json' -d '{"role":"SUPER_ADMIN"}'` then `curl -b c.txt localhost:3000/api/meetings`.

The seed already contains `test-reporter@test.com` (REPORTER with 5 direct reports and meetings) and `test-employee@test.com` (EMPLOYEE, no manager → onboarding), so `role: 'REPORTER'` / `'EMPLOYEE'` test-logins land on users with data; `'SUPER_ADMIN'` creates a fresh `test-super_admin@test.com`. The other seeded users (`nishant@test.com`, `hiten@test.com`, `ritesh@test.com`, `new-user@test.com`…) are only reachable through Google sign-in with a matching Workspace email.

Verified behaviour on the local run (useful when reading the backlog): unauthenticated `GET /api/todos` returns **500** (not 401) and a REPORTER opening `/admin` gets the error boundary with HTTP 200 — both are known defects (`REFACTOR_BACKLOG.md` #4, #28), not setup problems.

### What needs real credentials

| Feature | Needs |
|---|---|
| Google sign-in, Calendar events, free/busy slots | Real `GOOGLE_CLIENT_ID/SECRET` with Calendar API enabled; redirect URI `${NEXTAUTH_URL}/api/auth/callback/google`; user must re-login after scope changes |
| Recording / transcription / insights | an AI provider key (OpenAI **or** OpenRouter — one OpenRouter key covers transcription too) **and** S3 (`AWS_*`) — set via env or Admin → Settings (DB wins over env) |
| Email | `SMTP_*` + `EMAIL_FROM`, or `AWS_SES_FROM_EMAIL` + AWS keys |
| Cron (reminders, recurring generation) | `CRON_SECRET` + an external scheduler calling `POST /api/cron/meetings` hourly with header `x-cron-secret` |
| Keka leave/holidays | `KEKA_*` vars (see `docs/KEKA_INTEGRATION.md`) |
| Fathom transcripts | `FATHOM_WEBHOOK_SECRET` + webhook pointed at `/api/integrations/fathom/webhook` |

Mic recording requires a secure context (`localhost` counts; LAN IPs do not).

### Useful scripts

`npm run dev | build | start | lint | typecheck`, `npm test` (unit), `npm run test:smoke` (API e2e, needs dev server + seeded DB + `CRON_SECRET` in `.env`), `npm run check` (all static checks), `npm run db:generate | db:migrate | db:migrate:deploy | db:migrate:status | db:studio | db:seed`. Build uses `NODE_OPTIONS=--max-old-space-size=3072`.

### Testing

| Layer | Where | Runs |
|---|---|---|
| Unit (vitest) | `tests/unit/*.test.ts` — meeting state machine, access predicates, conflict check, team scoping, recurring-date math, encryption, Fathom signature, API wrapper/error mapping, every zod schema | `npm test`; no DB, `@/lib/prisma` is replaced by `tests/helpers/prisma-mock.ts` |
| API smoke (bash) | `scripts/smoke-api.sh` — logs in as seeded users by inserting `Session` rows, exercises auth mapping, validation, scoping, cancel policy, recording visibility, cron, pages; restores fixtures afterwards | `npm run test:smoke` against `http://localhost:3000` (override `BASE_URL`) |
| CI | `.github/workflows/ci.yml` | PRs/pushes to `stage` and `main` |
| Deploy gate | opt-in: `RUN_CHECKS=1 bash deploy.sh` runs typecheck + unit tests before building (off by default — CI is the gate; `tsc` OOMs on small servers) | on the server |

Conventions: one test file per `lib/` module; program `prismaMock.<model>.<method>.mockResolvedValue(...)` per test; pass mock implementations to `vi.fn(impl)` (the config restores mocks between tests); spy on `console.error` when a test exercises a logged failure path.

---

## 3. Repository layout

```
app/
  (auth)/auth/{signin,error}/        public pages
  (dashboard)/                       protected shell — layout.tsx does requireAuth() + onboarding redirect
    dashboard/ meetings/ todos/ employees/ reports/ insights/ notifications/ profile/ admin/
  (onboarding)/onboarding/           employee picks department + manager
  api/                               47 route handlers (see API_REFERENCE.md)
components/
  ui/        button, card, confirm-modal (useConfirm), toast (useToast), date-picker, skeleton
  forms/     one-on-one-form.tsx (react-hook-form + zod)
  layouts/   dashboard-layout, sidebar (nav + role gating), theme-provider
  notifications/notification-center.tsx (bell, 30s polling)
  providers/session-provider.tsx
  admin/bulk-import.tsx
lib/         all server logic — see §5
prisma/      schema.prisma, seed.ts
types/       next-auth.d.ts (session augmentation)
proxy.ts       security headers + cookie-presence redirect for protected prefixes
deploy/, deploy.sh, ecosystem.config.cjs   PM2/Nginx deployment
prisma/migrations/   migration history (0_init baseline)
```

### Page → data pattern

Server component page → Prisma query → serialize → props into a sibling `*-client.tsx`. Mutations are `fetch('/api/...')` from the client followed by `router.refresh()`. Exceptions that fetch on mount instead: `/notifications`, `/admin/audit-logs`, `/admin/storage`, `/admin/settings`, `/insights`, and the notification bell.

Role failures surface three different ways today: `notFound()` (`/insights`, `/admin/settings`, `/meetings/[id]`), `redirect` (`/meetings/recurring`), thrown `ForbiddenError` → error boundary (`/employees`, `/reports`, `/meetings/new`, `/admin/*`).

---

## 4. Data model (`prisma/schema.prisma`)

```
User ──reportsTo──▶ User (single level, no recursion)
User ──▶ Department
User 1─* Meeting (as employee)      User 1─* Meeting (as reporter)
Meeting 1─1 CalendarEvent, 1─1 MeetingRecording, 1─* Attachment, 1─* Todo, *─1 RecurringSchedule
User 1─* Todo (assigned / created)
User 1─* Notification, AuditLog, DashboardWidget, Account, Session
SystemSettings (singleton id='system')     BackupHistory
```

| Model | Key fields / notes |
|---|---|
| `User` | `role` EMPLOYEE/REPORTER/SUPER_ADMIN, `reportsToId`, `departmentId`, `isActive`, `country`, `timeZone`, `workDayStart/End` (HH:mm), `kekaEmployeeId` |
| `Meeting` | `status` PROPOSED/SCHEDULED/COMPLETED/CANCELLED (default PROPOSED), `proposedById`, `meetingType` IN_PERSON/ZOOM, `meetingLink`, `zoomMeetingId`, 10 form text fields, `formSubmittedAt`, `notes`, reminder flags (`reminder24hSent`, `reminderSent`, `formReminderSent`), `recurringScheduleId` |
| `RecurringSchedule` | `frequency` WEEKLY/BIWEEKLY/MONTHLY, `dayOfWeek` 0-6, `timeOfDay` HH:mm, `nextMeetingDate`, `googleRecurringEventId`, `isActive` (soft delete) |
| `MeetingRecording` | `audioKey` (S3 prefix → `…/final.webm`), `transcript`, `summary`, `keyPoints`/`autoTodos`/`sentiment`/`qualityDetails` (Json), `qualityScore`, `status` UPLOADING→UPLOADED→TRANSCRIBING→ANALYZING→COMPLETED/FAILED |
| `Todo` | `status` NOT_STARTED/IN_PROGRESS/DONE, `priority` HIGH/MEDIUM/LOW, `dueDate`, optional `meetingId` (SET NULL when the meeting is deleted) |
| `SystemSettings` | `openaiApiKey`, `awsAccessKeyId`, `awsSecretKey` encrypted (AES-256-GCM v2, key from `ENCRYPTION_SECRET`), `openaiModel`, `whisperModel`, `maxRecordingMins` (25). **Policies**: `requireFormBeforeComplete` (true), `cancelPolicy` (REPORTER_AND_ADMIN), `employeeCanViewRecording` (false), `employeeCanViewNotes` (true), `enableEmailReminders` (true), `reminderHoursBefore` (24), `shortReminderHoursBefore` (1) |
| `Notification` | `type` enum (10 values); PROPOSED/ACCEPTED/SUGGESTED/COMPLETED all reuse `MEETING_SCHEDULED` |
| `AuditLog` | `action` CREATE/UPDATE/DELETE/LOGIN/LOGOUT/EXPORT/IMPORT/CLEAR_DATA/SETTINGS_CHANGE; cascades with User |
| `CalendarEvent` | `googleEventId`, `googleCalendarLink`; created on **accept**, on the reporter's calendar |

Cascade summary: `Account`, `Session`, `Notification`, `AuditLog`, `RecurringSchedule`, `CalendarEvent`, `MeetingRecording`, `Attachment` cascade from their parent; `Todo.meeting` is SET NULL; `Meeting.employee/reporter` restrict (user DELETE route removes meetings explicitly). `DashboardWidget` was dropped.

---

## 5. Server modules (`lib/`)

| Module | Responsibility | Read this when… |
|---|---|---|
| `auth.ts` | NextAuth options: Google provider, domain restriction (`GOOGLE_WORKSPACE_DOMAIN`), inactive-user blocking, session enrichment (`id, role, departmentId, reportsToId`), token persistence | Touching login or session shape |
| `api.ts` | `withApiAuth(roles?, handler)`, `withPublicRoute`, `parseBody`/`parseQuery` (zod), `ApiError` + `notFound/forbidden/badRequest/conflict`, uniform error mapping (zod→400, P2002→409, P2025→404, Unauthorized→401) | Any new route |
| `validation/*.ts` | zod schemas per resource (`meetings`, `recurring`, `todos`, `users`, `admin`, `misc`, `common`) | Changing a request shape |
| `meeting-access.ts` | `canViewMeeting`, `canManageMeeting`, `canFillForm`, `canAccept`, `canSuggest`, `canCancel` (policy), `canViewRecording`/`canViewNotes` (policy), `assertAccess` | Any meeting route or page |
| `meeting-state.ts` | State machine (`assertTransition`), `completeMeeting`, `cancelMeeting` (calendar delete + notify + email), `loadMeeting` | Status changes |
| `meeting-conflicts.ts` | `assertNoConflict(employeeId, reporterId, date, excludeId?)` — 30-min overlap → 409 | Scheduling |
| `team.ts` | `getTeamUserIds(user)` (null = admin), `canActOnUser(user, targetId)` — one-level hierarchy | Scoping lists, assigning todos |
| `constants.ts` | `DEFAULT_TIMEZONE`, `MEETING_DURATION_MINUTES`, `ALLOWED_EMAIL_DOMAIN` (from `GOOGLE_WORKSPACE_DOMAIN`), `APP_NAME` | — |
| `auth-helpers.ts` | `getCurrentUser()`, `requireAuth()` (redirects — **page use only**), `requireRole`/`requireAdmin` (throw), `canAccessEmployeeData` (legacy; pages still use it) | Pages |
| `settings.ts` | `getSettings()` / `getPolicies()` — DB `SystemSettings` row wins over env, per field; 5-min cache (defaults cached too); `updateSettings()` encrypts secrets; `safeDecrypt` logs instead of throwing when the encryption secret changed | OpenAI/S3 config, policies |
| `encryption.ts` | AES-256-GCM; v2 key = HKDF(`ENCRYPTION_SECRET`), legacy scrypt format still readable; `isEncrypted`/`isLegacyCiphertext`; `ENCRYPTION_SECRET_PREVIOUS` for rotation; `scripts/reencrypt-secrets.ts` | Secrets, rotation |
| `ai.ts` | Provider registry (`PROVIDERS`), `getAiConfig()`/`getAiClient()` (settings → baseURL, key, chat/fast/stt models), `normalizeModelId` (`gpt-4o` ⇄ `openai/gpt-4o`), `chatJson()` (JSON mode with fence-stripping fallback for models that reject `response_format`), `listModels(kind)` for the Settings pickers | Any AI call |
| `transcription-quality.ts` | Pure helpers: `buildTranscriptionPrompt()` (native-script primer + participant names), `collapseRepetitions()` (hallucination-loop guard), `detectLanguageByScript()`, `isGpt4oTranscribe()` / `modelSegmentCap()` / `preferredResponseFormat()` | `openai.ts` |
| `dates.ts` | The only date formatter: `formatDate/DateTime/Time/MeetingShort/MeetingLong/DayHeading/MonthDay(d, tz)`, `formatDateOnly` (calendar dates, UTC-safe), `toDateKey`, `startOfDayInTz/endOfDayInTz`, `isTodoOverdue(due, now, status, tz)`, `timeZoneAbbrev`, `formattersFor(tz)` (what `useFormat()` returns) | everything that shows a date |
| `recording-pipeline.ts` | `startJob()`, `runJob()` (resumable COMBINE→TRANSCRIBE→ANALYZE), `recoverStaleJobs()` (cron), `resolveStartStage()`, `latestJob()` | `recording/process`, `recording/reprocess`, `recording` GET, cron |
| `openai.ts` | `transcribeAudio()` (temp file → ffmpeg compress → segment when >24 MB or longer than the provider's per-request limit → `verbose_json`, `json` fallback, language-name → ISO normalisation), `analyzeTranscript()`, `searchTranscripts()` (fast model), `generateOrganizationInsights()` — all via `lib/ai.ts` | Recording pipeline, insights |
| `s3.ts` | Settings-driven S3 client, `uploadToS3`, signed GET/PUT URLs, `deleteS3Prefix`, key helpers `recordings/<meetingId>/<ts>/chunk_NNNN.webm` + `final.webm` | Storage |
| `google-calendar.ts` | Per-user OAuth2 client with auto token refresh → `Account`; `createCalendarEvent` (30-min, Meet link, attendees both), `createRecurringCalendarEvent` (1-year RRULE), `updateCalendarEvent`, `deleteCalendarEvent`, `getMutualFreeSlots` (free/busy ∩ both users' work hours in their TZs) | Scheduling / availability |
| `email.ts` | Transport pick (SMTP → SES → throw), 11 templates. All times rendered in `Asia/Kolkata`; links from `NEXTAUTH_URL` | Notifications |
| `notifications.ts` | In-app notification CRUD + `notify*` helpers (all scoped by `userId`) | Notifications |
| `recurring-dates.ts` | First/next occurrence math in schedule TZ; MONTHLY = "first matching weekday on/after same date next month" (differs from the Google RRULE) | Recurring schedules |
| `keka.ts` | Keka token + holiday/leave lookups → `isDateUnavailableForEitherUser()`; silent no-op when unconfigured | Availability |
| `fathom-webhook.ts` | Standard-Webhooks HMAC verification | Fathom |
| `zoom.ts` | `parseZoomMeetingId(link)` only — no Zoom API | — |
| `audit.ts` | `createAuditLog` + typed `log*` helpers; swallows errors | Any mutating route |
| `timezones.ts`, `utils.ts` | Country/TZ options, default work hours (IN 11:00–21:00, US 04:30–16:00), `cn()`, date formatters (default IST), `isTodoOverdue` | Display |
| `rate-limit.ts` | In-memory limiter; wired on test-login/cron (`auth`), recording upload + AI routes + webhook (`api`), recording process (`recordings`) | Abuse protection |
| `prisma.ts` | Singleton client, query logging in dev | — |

---

## 6. Auth & authorization

- Middleware only checks the session **cookie is present** for `/dashboard, /meetings, /todos, /employees, /reports, /insights, /admin, /profile, /notifications`; `/onboarding` is guarded by its layout; API routes are not gated by middleware — every handler must call a helper.
- Session: `database` strategy. `session` callback re-reads the user on every request and purges sessions of inactive users.
- Roles: `EMPLOYEE` (own meetings/todos/profile), `REPORTER` (own + direct reports via `User.reportsToId`, one level only), `SUPER_ADMIN` (everything + `/admin/*`).
- `canAccessEmployeeData` is the one reusable object-level check. Note it keys on the employee's **current** manager, while meeting routes key on `meeting.reporterId` — after a reporting change the two diverge.
- Every API route is wrapped in `withApiAuth` (401/403 mapped uniformly). Todos are scoped to self + direct reports for reporters; `/api/profile` cannot change manager/department (admin + onboarding only).
- Cookie name: `__Secure-next-auth.session-token` when `NODE_ENV=production` **and** `NEXTAUTH_URL` starts with https (`lib/auth.ts`); middleware and test-login only check `NODE_ENV`. Keep production on HTTPS.

---

## 7. Core flows

### Meeting lifecycle

```
REPORTER/ADMIN ─POST /api/meetings or /api/recurring-schedules─▶ PROPOSED (proposedById = caller)
   receiver ─POST /accept─▶ SCHEDULED  (+ Google Calendar event on reporter's calendar, email+notif to proposer,
                                        for recurring: next occurrence auto-created as SCHEDULED)
   either side ─POST /suggest {meetingDate}─▶ stays PROPOSED, proposedById flips to the suggester
   reporter/ADMIN ─PATCH {status:'COMPLETED'}─▶ COMPLETED  (blocked 400 if requireFormBeforeComplete && !formSubmittedAt)
   employee ─POST /form {draft?}─▶ writes 10 fields; submit sets formSubmittedAt once, emails reporter
   ADMIN ─DELETE─▶ hard delete (+ calendar event). Fails if todos reference it.
```

Cancel: `POST /api/meetings/[id]/cancel {reason?}` on a PROPOSED/SCHEDULED meeting. Allowed for admins always, and otherwise per the `cancelPolicy` setting (`ADMIN_ONLY` | `REPORTER_AND_ADMIN` (default) | `ANY_PARTICIPANT`). Deletes the calendar event, notifies + emails the other party, audits. Pausing/deleting a recurring schedule with `cancelFutureMeetings` cancels future SCHEDULED occurrences.

Transitions are enforced in `lib/meeting-state.ts` (`assertTransition`): COMPLETED only from SCHEDULED. The 30-min conflict check (`lib/meeting-conflicts.ts`) runs on create and on suggest.

### Recurring schedules

Occurrences are produced by three places, each guarded by "no non-cancelled meeting at exactly `nextMeetingDate`" then advancing `nextMeetingDate`: schedule POST (#1 as PROPOSED), accept (#N+1 as SCHEDULED), cron (anything due within 7 days; SCHEDULED if the schedule ever had a SCHEDULED/COMPLETED meeting, else PROPOSED). Only one occurrence per schedule per cron run.

### Recording pipeline

Browser (`meeting-recorder.tsx`, Reporter+ only): `MediaRecorder` webm/opus, 5-s data chunks batched every 30 s → `POST …/recording/upload` (multipart, server-side `PutObject`). Session starts with `POST …/recording/presign` (misnamed — creates the DB row, returns `sessionKey`). "Save & Transcribe" → `POST …/recording/process {totalChunks, duration, language}` → creates a **`RecordingJob`** row and runs it detached via `lib/recording-pipeline.ts`. Client polls `GET …/recording` every 3 s (`recording.status` + `job`). Max duration from `SystemSettings.maxRecordingMins`.

Stages (`RecordingStage`), each skipped when its output already exists: **COMBINE** (concat chunks → `<session>/final.webm`, repoint `audioKey`, delete chunks) → **TRANSCRIBE** (`transcribeAudio`; silence short-circuits to COMPLETED) → **ANALYZE** (`analyzeTranscript` → summary/keyPoints/todos/sentiment/quality, notify both parties on a first run). `MeetingRecording.status` stays the user-facing status; the job row carries `stage/attempt/error` and is the per-recording lock (`startJob` throws `BUSY` while one is QUEUED/RUNNING). Each stage writes `heartbeatAt`; the hourly cron calls `recoverStaleJobs()` — a job with no heartbeat for 30 min (process restarted mid-run) is re-run **from its current stage** up to `MAX_ATTEMPTS` (3), then failed with a message telling the user to Reprocess.

`POST …/recording/reprocess {from?}` (reporter/admin) re-runs from TRANSCRIBE (stored `final.webm`) or ANALYZE (stored transcript) — no re-recording. The meeting page offers *Re-transcribe* / *Re-run analysis* on completed and failed recordings; *Discard & record again* is the old delete path.

**Transcription quality** (`lib/openai.ts` + `lib/transcription-quality.ts`): default STT model is `gpt-4o-transcribe` (`openai/gpt-4o-transcribe` on OpenRouter) — whisper-1 drifts Gujarati into Devanagari on code-mixed speech and loops on quiet audio. Every request carries a steering `prompt` in the target script plus the participants' names and `temperature: 0`. On multi-segment recordings the language detected on segment 1 is pinned for the rest. whisper-1 rejects some ISO codes (`gu`), so an unsupported code is dropped with a warning rather than failing. After transcription `collapseRepetitions()` strips a phrase repeated 3+ times back-to-back, and when the model reports no language (gpt-4o-transcribe) it is inferred from the dominant script, then from the fast model.

Alternate ingress: Fathom webhook writes transcript/summary straight to `MeetingRecording` (no audio) for ZOOM meetings matched by `zoomMeetingId` or same-day + both participant emails.

### Cron (`POST /api/cron/meetings`, header `x-cron-secret`)

1. Generate due recurring occurrences. 2. First reminder (`reminderHoursBefore`, email + in-app) and short-notice reminder (`shortReminderHoursBefore`, in-app; 0 disables) for SCHEDULED meetings. 3. Form reminders to employees. 4. `recoverStaleJobs()` — resume or fail interrupted recording jobs. Email copies obey `enableEmailReminders`. `CRON_SECRET` is required in every environment (503 if unset, 401 on mismatch). Nothing in the repo schedules it — set up an external hourly caller (see `DEPLOYMENT.md`).

### Timezones

Every instant is stored in UTC and rendered in the **viewer's** `User.timeZone`. `app/(dashboard)/layout.tsx` mounts `TimeZoneProvider` with the session user's zone; when it is unset the provider writes the browser's zone to the profile once (`PATCH /api/profile`) and refreshes. Server components pass `user.timeZone` to `lib/dates`; client components use `useFormat()`. Meeting times shown to a party who may be in another zone carry the abbreviation (`Wed, Feb 18, 11:30 AM IST`). Calendar dates — todo due dates (stored 00:00 UTC from the picker), report ranges — use `formatDateOnly` and never shift. `isTodoOverdue` turns over at the viewer's local end of day. Emails look up the recipient's zone by address (`recipientTimeZone`, cached 60 s); in-app notification text is rendered in the recipient's zone at creation. Subjects are forced to ASCII (`asciiSubject`) so mail clients never show `=?UTF-8?Q?…?=`; every email also carries a plain-text part (`htmlToText`).

### Onboarding

`(dashboard)/layout.tsx`: `EMPLOYEE && !reportsToId` → `/onboarding` → pick department, then manager → `POST /api/onboarding`. A REPORTER without a manager is not redirected.

---

## 8. Environment variables

Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NODE_ENV`.
Strongly recommended: `INITIAL_ADMIN_EMAILS` (comma-separated; promoted to SUPER_ADMIN on sign-in, never demoted — replaces the manual SQL step), `CRON_SECRET`.
Required in production: `GOOGLE_WORKSPACE_DOMAIN` (boot fails without it), `ENCRYPTION_SECRET` (falls back to `NEXTAUTH_SECRET` with a warning; `ENCRYPTION_SECRET_PREVIOUS` during rotation — see `docs/ENV_VARIABLES.md`). Optional: `OPENAI_API_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` (all overridable in Admin → Settings), `SMTP_HOST/PORT/USER/PASSWORD`, `EMAIL_FROM`, `AWS_SES_FROM_EMAIL`, `FATHOM_WEBHOOK_SECRET`, `KEKA_ENVIRONMENT/COMPANY/CLIENT_ID/CLIENT_SECRET/API_KEY/HOLIDAY_CALENDAR_ID_US/_IN`, `ENABLE_TEST_LOGIN`.

`env.example` lists every variable with comments.

---

## 9. Deployment

See `DEPLOYMENT.md`. Summary: `deploy.sh` on the EC2 host at `/var/www/oneonone`: `git pull → npm ci → prisma generate → prisma migrate deploy → npm run build → pm2 restart oneonone` (`ecosystem.config.cjs`, port 3000). Nginx (`deploy/nginx-ssl.conf`) terminates TLS (Let's Encrypt, hostname hardcoded), `client_max_body_size 50M`, proxy timeouts 1800 s. Email/Calendar/SSL setup notes live in `deploy/*.md`. Never run `db:seed` in production — it wipes data.

**First deploy after the migrations baseline landed**: run `npx prisma migrate resolve --applied 0_init` once on the server before `deploy.sh` (the prod DB was created with `db push`). Details in `DEPLOYMENT.md` → "Migrating a database that was created with db push".

---

## 10. Conventions to follow when adding code

- New API route: `withApiAuth([roles], handler)` → `parseBody`/`parseQuery` with a schema from `lib/validation/` → object-level check (`lib/meeting-access.ts` / `lib/team.ts`) → Prisma (multi-write in `$transaction`) → audit → side effects (email/notification/calendar) best-effort with `.catch` → `NextResponse.json`. Throw `ApiError`s; never hand-roll 4xx responses.
- New page: server `page.tsx` does auth + Prisma, passes serialized props to `*-client.tsx`; add a `loading.tsx` using `components/ui/skeleton.tsx`.
- Use `useToast()` / `useConfirm()` rather than inline banners or custom modals; use `components/ui/button.tsx` + `card.tsx` (currently used by one file — adopt them rather than hand-rolling `rounded-2xl bg-white dark:bg-charcoal …`).
- Dates: store UTC; display via `lib/utils` formatters (currently default IST) — don't add more ad-hoc `toLocaleDateString` calls.
- Keep `'Asia/Kolkata'`, 30-min duration, app name, allowed email domain (`@whitelabeliq.com`, hardcoded in 4 places) in one constants module when touching them.
- Notify people through `@/lib/notify` (`notify.meetingProposed(...)`, `notify.todoAssigned(...)`, …): one call per event delivers in-app + email, never throws, logs `[notify] <event> <channel> failed`. Message wording stays in `lib/notifications.ts` / `lib/email.ts`.
- Scheduling availability (mutual free slots, first free recurring occurrence, working-hours label) lives in `lib/availability.ts`; calendar I/O stays in `lib/google-calendar.ts`, interval maths in `lib/free-slots.ts`.
- Import `@/lib/google-calendar` statically; the dynamic `await import()` pattern in routes is a holdover.
