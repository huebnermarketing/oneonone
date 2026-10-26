# CLAUDE.md — AMI One-on-One

Next.js 14 App Router + Prisma/Postgres + NextAuth (Google) app for managing 1:1 meetings, with audio recording → Whisper → GPT analysis, Google Calendar, email/in-app notifications, Keka + Fathom integrations.

Read first: `docs/DEVELOPER_GUIDE.md` (architecture, flows, setup), `docs/API_REFERENCE.md` (every route + auth rule), `docs/REFACTOR_BACKLOG.md` (known defects with file:line — check before "fixing" something that is already listed).

## Commands

```bash
npm run dev            # http://localhost:3000 (reads .env — Prisma CLI ignores .env.local)
npm run typecheck      # tsc --noEmit — clean; keep it that way
npm run lint           # clean
npm test               # vitest unit tests (tests/unit, no DB — prisma is mocked). Add a test for every lib/ change.
npm run test:smoke     # end-to-end API checks against a running dev server + seeded DB (scripts/smoke-api.sh). Never against prod.
npm run check          # typecheck + lint + test — run before every PR. CI runs the same plus build + migration drift check.
npm run db:migrate     # prisma migrate dev — use this for schema changes (creates prisma/migrations/*). Never db push.
npm run db:seed        # WIPES the DB, seeds @test.com users. Never in production.
npm run db:studio
npm run build          # NODE_OPTIONS=--max-old-space-size=3072 next build
```

Local login without Google: `POST /api/auth/test-login {"role":"SUPER_ADMIN"|"REPORTER"|"EMPLOYEE"}` sets a real session cookie (dev only).

## Layout

- `app/(dashboard)/<feature>/page.tsx` = server component (auth + Prisma) → props → `<feature>-client.tsx` (client, `fetch('/api/…')` + `router.refresh()`).
- `app/api/**/route.ts` = 46 handlers. `lib/` = all server logic. `components/ui` = toast/confirm/date-picker/skeleton/button/card.
- Use Prisma-generated types; there is no hand-written types module.
- `tests/unit/*.test.ts` mirror `lib/*`; `tests/helpers/prisma-mock.ts` gives a programmable `prisma`, `tests/helpers/fixtures.ts` gives users/meetings. `tests/setup.ts` auto-mocks prisma, email and google-calendar. Mock implementations must be passed to `vi.fn(impl)` (restoreMocks is on).

## Rules for changes

- **API routes**: `export const GET = withApiAuth([roles], async (req, { user, params }) => …)` from `lib/api.ts` (or `withPublicRoute` for health/webhooks/cron). Parse input with `parseBody(req, schema)` / `parseQuery(req, schema)` using schemas in `lib/validation/*.ts`. Throw `ApiError`/`notFound()`/`forbidden()`/`badRequest()`/`conflict()`; the wrapper maps errors (zod → 400 with `details`, P2002 → 409, P2025 → 404). Object-level checks: `lib/meeting-access.ts` (`canViewMeeting`, `canManageMeeting`, `canCancel`, `canViewRecording`…), `lib/team.ts` (`getTeamUserIds`, `canActOnUser`). Status changes go through `lib/meeting-state.ts`. Audit every mutation. Static imports only (no `await import('@/lib/…')`). Never `requireAuth()`/`requireRole()` in a route.
- **Prisma schema change**: `npx prisma migrate dev --name <change>` and commit the new folder under `prisma/migrations/`. Mind missing cascades (`Todo.meeting`, `AuditLog.user`, `RecurringSchedule.*`).
- **AI calls** go through `lib/ai.ts` (`getAiClient()`, `chatJson()`); never `new OpenAI()` in a route. Provider (OpenAI/OpenRouter), key and the three models (chat / fast / transcription) live in `SystemSettings` → Admin → Settings → AI Provider. Model ids are provider-prefixed on OpenRouter (`openai/gpt-4o`); `normalizeModelId` handles the switch. Transcription steering (prompt per language, repetition guard, language fallback) lives in `lib/transcription-quality.ts` — pure functions, test them.
- **Policies** live in `SystemSettings` (Admin → Settings → Policies) and are read via `getPolicies()`: `requireFormBeforeComplete`, `cancelPolicy`, `employeeCanViewRecording`, `employeeCanViewNotes`, `enableEmailReminders`, `reminderHoursBefore`, `shortReminderHoursBefore`. Gate behaviour on these, don't hardcode.
- **Secrets**: `SystemSettings` row overrides env per field; `openaiApiKey`/`awsAccessKeyId`/`awsSecretKey` are AES-GCM encrypted (`lib/encryption.ts`, v2 format, key from `ENCRYPTION_SECRET` via HKDF; `NEXTAUTH_SECRET` fallback). Rotation = `ENCRYPTION_SECRET_PREVIOUS` + `npm run secrets:reencrypt`. Production refuses to boot without `GOOGLE_WORKSPACE_DOMAIN`.
- **Dates**: store UTC; display helpers in `lib/utils.ts` default to `Asia/Kolkata`. Don't add new `toLocaleDateString` calls; the TZ story is being consolidated (backlog #24).
- **Recording pipeline**: `lib/recording-pipeline.ts` — every run is a `RecordingJob` (COMBINE → TRANSCRIBE → ANALYZE, resumable, heartbeat + cron recovery). Routes call `startJob()`; never run transcription/analysis inline in a route. Reprocess = `POST /api/meetings/[id]/recording/reprocess`.
- **Meeting state**: PROPOSED → (accept) SCHEDULED → COMPLETED; PROPOSED/SCHEDULED → CANCELLED via `POST /api/meetings/[id]/cancel` (who may cancel = `cancelPolicy` setting). Transitions are enforced in `lib/meeting-state.ts`. Calendar events are created on accept, on the reporter's calendar.
- **UI**: use `useToast()`/`useConfirm()`, `components/ui/*`, Tailwind brand tokens (`orange`, `charcoal`, `dark-gray`, `medium-gray`, `light-gray`, `off-white`); every route needs a `loading.tsx`.
- Prefer static imports of `@/lib/email`, `@/lib/notifications`, `@/lib/google-calendar`; the `await import()` pattern in routes is legacy.
- Constants: `lib/constants.ts` (`DEFAULT_TIMEZONE`, `MEETING_DURATION_MINUTES`, `ALLOWED_EMAIL_DOMAIN`, `APP_NAME`). Client components still carry a few literals (`user-management.tsx` domain, slot-grid timezone) — next cleanup target.

## Env (local minimum)

`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`, `NODE_ENV=development`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (placeholders OK — `lib/auth.ts` only checks presence), `GOOGLE_WORKSPACE_DOMAIN`, `INITIAL_ADMIN_EMAILS`, `ENCRYPTION_SECRET`. Optional: `AI_PROVIDER` + `OPENAI_API_KEY`/`OPENROUTER_API_KEY`, `AWS_*` (S3 required for recording), SMTP/SES, `FATHOM_WEBHOOK_SECRET`, `KEKA_*`. `CRON_SECRET` is now required for `/api/cron/meetings` in every environment.

## Branch flow

Branch from `stage` (`feature/<name>` or `refactor/<name>`), PR into `stage`. Tarang merges `stage → main` for releases. Never commit to `main` or `stage` directly.

## Deployment

PM2 + Nginx on EC2 only (`DEPLOYMENT.md`, `deploy.sh`, `ecosystem.config.cjs`, `deploy/`). No Docker. `deploy.sh` runs `prisma migrate deploy`.
