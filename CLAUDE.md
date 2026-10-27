# CLAUDE.md — AMI One-on-One

Next.js 16 App Router (React 19) + Prisma/Postgres + NextAuth (Google) app for managing 1:1 meetings, with audio recording → Whisper → GPT analysis, Google Calendar, email/in-app notifications, Keka + Fathom integrations.

Read first: `docs/DEVELOPER_GUIDE.md` (architecture, flows, setup), `docs/API_REFERENCE.md` (every route + auth rule), `docs/REFACTOR_BACKLOG.md` (known defects with file:line — check before "fixing" something that is already listed).

## Commands

```bash
npm run dev            # http://localhost:3000, Turbopack (reads .env — Prisma CLI ignores .env.local)
npm run typecheck      # tsc --noEmit — clean; keep it that way
npm run lint           # ESLint 9 flat config (eslint.config.mjs) — 0 errors; React Compiler rules are warnings (backlog)
npm test               # vitest unit tests (tests/unit, no DB — prisma is mocked). Add a test for every lib/ change.
npm run test:smoke     # end-to-end API checks against a running dev server + seeded DB (scripts/smoke-api.sh). Never against prod.
npm run check          # typecheck + lint + test — run before every PR. CI runs the same plus build + migration drift check.
npm run db:migrate     # prisma migrate dev — use this for schema changes (creates prisma/migrations/*). Never db push.
npm run db:seed        # WIPES the DB, seeds @test.com users. Never in production.
npm run db:studio
npm run build          # next build --webpack, 3 GB heap (webpack peaks ~2.3 GB vs Turbopack ~3.2 GB — keeps prod box headroom)
```

Local login without Google: `POST /api/auth/test-login {"role":"SUPER_ADMIN"|"REPORTER"|"EMPLOYEE"}` sets a real session cookie (dev only).

## Layout

- `app/(dashboard)/<feature>/page.tsx` = server component (auth + Prisma) → props → `<feature>-client.tsx` (client, `fetch('/api/…')` + `router.refresh()`).
- `app/api/**/route.ts` = 46 handlers. `lib/` = all server logic. `components/ui` = primitives (see UI rule below); `components/forms` = employee picker, slot grid; `components/providers` = session/theme/timezone.
- Use Prisma-generated types; there is no hand-written types module.
- `tests/unit/*.test.ts` mirror `lib/*`; `tests/helpers/prisma-mock.ts` gives a programmable `prisma`, `tests/helpers/fixtures.ts` gives users/meetings. `tests/setup.ts` auto-mocks prisma, email and google-calendar. Mock implementations must be passed to `vi.fn(impl)` (restoreMocks is on).

## Rules for changes

- **Next 16 specifics**: page/layout `params`/`searchParams` are Promises (`const { id } = await props.params`); `cookies()`/`headers()` must be awaited; route handlers get `params` already awaited from the `withApiAuth`/`withPublicRoute` wrapper. Request gating + security headers live in `proxy.ts` (formerly middleware). Node ≥ 20.9.
- **API routes**: `export const GET = withApiAuth([roles], async (req, { user, params }) => …)` from `lib/api.ts` (or `withPublicRoute` for health/webhooks/cron). Parse input with `parseBody(req, schema)` / `parseQuery(req, schema)` using schemas in `lib/validation/*.ts`. zod 4: `z.record` takes a key schema, `.default()` takes the OUTPUT value (use `.prefault()` to run inner defaults); user-facing default messages come from `lib/zod-messages.ts` (import it in any client component that builds its own schema). Throw `ApiError`/`notFound()`/`forbidden()`/`badRequest()`/`conflict()`; the wrapper maps errors (zod → 400 with `details`, P2002 → 409, P2025 → 404). Object-level checks: `lib/meeting-access.ts` (`canViewMeeting`, `canManageMeeting`, `canCancel`, `canViewRecording`…), `lib/team.ts` (`getTeamUserIds`, `canActOnUser`). Status changes go through `lib/meeting-state.ts`. Audit every mutation. Static imports only (no `await import('@/lib/…')`). Never `requireAuth()`/`requireRole()` in a route.
- **Prisma schema change**: `npx prisma migrate dev --name <change>` and commit the new folder under `prisma/migrations/`. Mind missing cascades (`Todo.meeting`, `AuditLog.user`, `RecurringSchedule.*`).
- **AI calls** go through `lib/ai.ts` (`getAiClient()`, `chatJson()`); never `new OpenAI()` in a route. Provider (OpenAI/OpenRouter), key and the three models (chat / fast / transcription) live in `SystemSettings` → Admin → Settings → AI Provider. Model ids are provider-prefixed on OpenRouter (`openai/gpt-4o`); `normalizeModelId` handles the switch. Transcription steering (prompt per language, repetition guard, language fallback) lives in `lib/transcription-quality.ts` — pure functions, test them.
- **Policies** live in `SystemSettings` (Admin → Settings → Policies) and are read via `getPolicies()`: `requireFormBeforeComplete`, `cancelPolicy`, `employeeCanViewRecording`, `employeeCanViewNotes`, `enableEmailReminders`, `reminderHoursBefore`, `shortReminderHoursBefore`. Gate behaviour on these, don't hardcode.
- **Secrets**: Google OAuth tokens in `Account` are encrypted at rest — read/write only via `lib/oauth-tokens.ts` (`getGoogleTokens`, `saveGoogleTokens`; the NextAuth adapter's `linkAccount` seals them, and every sign-in stores fresh ones). Never log emails — use `maskEmail`/`maskRecipients` (`lib/redact.ts`). `SystemSettings` row overrides env per field; `openaiApiKey`/`awsAccessKeyId`/`awsSecretKey` are AES-GCM encrypted (`lib/encryption.ts`, v2 format, key from `ENCRYPTION_SECRET` via HKDF; `NEXTAUTH_SECRET` fallback). Rotation = `ENCRYPTION_SECRET_PREVIOUS` + `npm run secrets:reencrypt` (covers settings and Account tokens). Production refuses to boot without `GOOGLE_WORKSPACE_DOMAIN`.
- **Dates**: store UTC; render in the VIEWER's timezone via `lib/dates.ts` only — server components `formatMeetingShort(d, user.timeZone)`, client components `const f = useFormat()` (`components/providers/timezone-provider`). Calendar dates (todo due dates, report ranges, `YYYY-MM-DD` strings) go through `formatDateOnly` so they never shift a day. Emails/notifications render in the recipient's zone (`recipientTimeZone()` / `whenFor()`). Never call `toLocale*String` or `new Intl.DateTimeFormat` outside `lib/dates.ts`; `User.timeZone` is auto-detected from the browser on first visit and editable in Profile.
- **Recording pipeline**: `lib/recording-pipeline.ts` — every run is a `RecordingJob` (COMBINE → TRANSCRIBE → ANALYZE, resumable, heartbeat + cron recovery). Routes call `startJob()`; never run transcription/analysis inline in a route. Reprocess = `POST /api/meetings/[id]/recording/reprocess`.
- **Meeting state**: PROPOSED → (accept) SCHEDULED → COMPLETED; PROPOSED/SCHEDULED → CANCELLED via `POST /api/meetings/[id]/cancel` (who may cancel = `cancelPolicy` setting). Transitions are enforced in `lib/meeting-state.ts`. Calendar events are created on accept, on the reporter's calendar.
- **UI**: use the primitives before writing markup — `components/ui/`: `Pill`/`MeetingStatusPill`/`TodoStatusPill`/`TodoPriorityPill`, `Avatar` (+`initials`), `StatCard`, `Select`, `Modal` (role=dialog, focus trap, Esc), `Pagination`, `Button`, `DatePicker`, `useToast()`/`useConfirm()`; `components/forms/`: `EmployeePicker`, `SlotGrid`; `components/notifications/notification-meta.tsx` for type→icon/label; `lib/ui.ts` (`DAY_NAMES`, `languageName`, `formatFileSize`, `greeting`, `plural`), `lib/slots.ts` (scheduling helpers, timezone-explicit). Tailwind brand tokens (`orange`, `charcoal`, `dark-gray`, `medium-gray`, `light-gray`, `off-white`); every route needs a `loading.tsx`. Every `catch` that affects the user calls `toastError`; icon-only buttons get `aria-label`; tab groups get `role="tablist"`. The sidebar owns the single notification poller (`useNotifications()`).
- **Notifications**: routes and lib code never call `send*Email`/`notify*` directly — use `lib/notify.ts` (`import * as notify from '@/lib/notify'`; one function per event, both channels, never throws, returns `{ ok, failures }`). New event = new function there + a test in `tests/unit/notify.test.ts`; a new `NotificationType` needs an enum migration and an entry in `components/notifications/notification-meta.tsx` (a test enforces it). `MEETING_SCHEDULED` is legacy — don't write it. Policy gating (`enableEmailReminders`) is passed in as `email: boolean`.
- **User import/export**: `lib/user-import.ts` — one CSV format (`lib/user-import-columns.ts`, client-safe) for template, export and import. `planImport()` is pure (preview); `applyImport()` writes valid rows in one transaction. Rules: email = key (new → create, existing → update), blank cell keeps the current value, departments auto-created, managers by email in any order, anyone with a direct report is promoted to REPORTER, users not in the file are untouched. New column = add to `IMPORT_COLUMNS` + `COLUMN_HELP` + header aliases + export, with a test.
- **Keka employee sync / sign-in**: `lib/keka-sync.ts` (+ `lib/keka-employees.ts` client, `lib/sign-in-gate.ts`). Keka-owned fields (`KEKA_OWNED_FIELDS`) are read-only for synced users — routes that edit users call `lockedFieldChanges()`. Sign-in: in the app → allowed (inactive blocked); not in the app → created from Keka if active, else refused; `INITIAL_ADMIN_EMAILS` always allowed. Never store personal Keka fields; extend `pickEmployee` only with work fields.
- **Availability**: `lib/availability.ts` (`loadPairProfiles`, `freeSlotsForDay`, `firstFreeOccurrence`, `calendarsConnected`, `workingHoursLabel`) — don't recompute free slots in a route. Only ONE of the two people needs a connected Google Calendar: `getPairBusy` (lib/google-calendar.ts) reads the other's free/busy by email through it (Workspace shares free/busy internally), falling back to the other's own connection; it throws `CalendarUnavailableError` when neither works — routes turn that into `calendarUnavailable`.
- Prefer static imports of `@/lib/google-calendar`; the `await import()` pattern in routes is legacy.
- Constants: `lib/constants.ts` (`DEFAULT_TIMEZONE`, `MEETING_DURATION_MINUTES`, `ALLOWED_EMAIL_DOMAIN`, `APP_NAME`). The admin user form gets the domain from the server (`emailDomain` prop).

## Env (local minimum)

`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`, `NODE_ENV=development`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (placeholders OK — `lib/auth.ts` only checks presence), `GOOGLE_WORKSPACE_DOMAIN`, `INITIAL_ADMIN_EMAILS`, `ENCRYPTION_SECRET`. Optional: `AI_PROVIDER` + `OPENAI_API_KEY`/`OPENROUTER_API_KEY`, `AWS_*` (S3 required for recording), SMTP/SES, `FATHOM_WEBHOOK_SECRET`, `KEKA_*`. `CRON_SECRET` is now required for `/api/cron/meetings` in every environment.

## Branch flow

Branch from `stage` (`feature/<name>` or `refactor/<name>`), PR into `stage`. Tarang merges `stage → main` for releases. Never commit to `main` or `stage` directly.

## Deployment

PM2 + Nginx on EC2 only (`DEPLOYMENT.md`, `deploy.sh`, `ecosystem.config.cjs`, `deploy/`). No Docker. `deploy.sh` runs `prisma migrate deploy`.
