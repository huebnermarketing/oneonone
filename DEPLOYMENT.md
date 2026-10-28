# Deployment

Production runs as a **single Node process under PM2 on an EC2 host, behind Nginx with Let's Encrypt TLS**, talking to a PostgreSQL database. There is no Docker/ECS path (removed — it was never functional). Everything below reflects the files actually in the repo: `deploy.sh`, `ecosystem.config.cjs`, `deploy/nginx-ssl.conf`, `deploy/setup-ssl-on-server.sh`.

```
Browser ──443──▶ Nginx (TLS, 50 MB uploads, 1800 s proxy timeout) ──3000──▶ next start (PM2 "oneonone") ──▶ PostgreSQL
                                                                                      ├──▶ Google OAuth / Calendar
                                                                                      ├──▶ OpenAI (Whisper + GPT)
                                                                                      ├──▶ S3 (recordings, attachments)
                                                                                      └──▶ SMTP or SES (email)
```

## Server prerequisites (one-time)

- Ubuntu 22.04+, Node 20 LTS or newer, `npm`, `pm2` (`npm i -g pm2`), Nginx, Certbot, `ffmpeg` (optional — `ffmpeg-static` is bundled, system ffmpeg is the fallback).
- PostgreSQL reachable from the host (local Postgres or RDS). Database `ami_oneonone`, user with full rights on it.
- Node.js ≥ 20.9 (`node -v`). Next 16 and nodemailer 10 refuse older versions.
- App checked out at `/var/www/oneonone` (`deploy.sh` checks out and pulls `main`, or `stage` when `DEPLOY_BRANCH=stage`).
- `.env` in the app root — see "Environment" below. `deploy.sh` writes a placeholder and exits if it is missing.
- Security group: inbound 80 + 443. Port 3000 must **not** be public.

## Branch flow

`feature/*` or `refactor/*` → PR into **`stage`** (integration; deploy to the test server with `DEPLOY_BRANCH=stage`) → `stage` merged into **`main`** when a release is signed off → `bash deploy.sh` on production.

## Routine deploy

```bash
ssh <host>
cd /var/www/oneonone
bash deploy.sh                      # production: pulls main
DEPLOY_BRANCH=stage bash deploy.sh  # test server: pulls stage
```

`deploy.sh` does, in order: `git checkout $DEPLOY_BRANCH && git pull` (if the pull changed `deploy.sh` itself, the script re-execs the fresh copy so the rest of the run uses the new steps — bash otherwise keeps running the old file) → `npm ci` → `prisma generate` → `prisma migrate deploy` → (`RUN_CHECKS=1` only: typecheck + unit tests) → `next build` (3 GB heap) → verify `.next/BUILD_ID` → `pm2 delete oneonone; pm2 start ecosystem.config.cjs; pm2 save`. Any step failing aborts before PM2 is touched, so a bad build never replaces a running one. Quality gates run in CI on every PR; on the server they are opt-in because `tsc` needs more heap than a small instance has.

Never run `npm run db:seed` on the server — it wipes every table.

## Database migrations

Schema changes ship as files under `prisma/migrations/`. Workflow:

```bash
# locally, after editing prisma/schema.prisma
npx prisma migrate dev --name <describe_change>    # creates + applies the migration, regenerates client
git add prisma/migrations && git commit
# on the server, deploy.sh runs: npx prisma migrate deploy
```

### Migrating a database that was created with `db push` (one-time)

Before the migrations baseline (`0_init`) existed, the production schema was applied with `prisma db push`. The first `migrate deploy` on such a database would try to re-create every table and fail. Mark the baseline as already applied, once:

```bash
cd /var/www/oneonone
git pull origin main
npx prisma migrate resolve --applied 0_init
npx prisma migrate status        # expect: "Database schema is up to date!"
bash deploy.sh
```

If `migrate status` reports drift (columns that exist in the DB but not in `0_init`, or vice versa), stop and compare with `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma` before proceeding.

## Environment

`.env` on the server (never committed). Required:

| Var | Notes |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/ami_oneonone?schema=public` |
| `NEXTAUTH_URL` | Exactly how users reach the app, e.g. `https://oneonone.example.com` (no trailing slash). Must match the Google OAuth redirect URI `${NEXTAUTH_URL}/api/auth/callback/google`. |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32`. Signs sessions. |
| `ENCRYPTION_SECRET` | `openssl rand -base64 32`. Encrypts API keys stored in Admin → Settings and users' Google OAuth tokens. See `docs/ENV_VARIABLES.md` → Encryption for the one-time adoption step (`npm run secrets:reencrypt`) and rotation. |
| `NODE_ENV` | `production` (also set by `ecosystem.config.cjs`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client with Calendar API enabled (`deploy/GOOGLE-CALENDAR-SETUP.md`) |
| `GOOGLE_WORKSPACE_DOMAIN` | Restrict sign-in to one domain. **Required in production** — the app refuses to boot without it. |
| `INITIAL_ADMIN_EMAILS` | Comma-separated emails promoted to SUPER_ADMIN on sign-in (first-admin bootstrap; only promotes, never demotes). |
| `CRON_SECRET` | Required for `/api/cron/meetings` in production. |

Optional: `OPENAI_API_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` (all can be set in Admin → Settings instead; DB wins over env), email via `SMTP_HOST/PORT/USER/PASSWORD` + `EMAIL_FROM` (`deploy/EMAIL-SMTP-SETUP.md`) or `AWS_SES_FROM_EMAIL`, `FATHOM_WEBHOOK_SECRET`, `KEKA_*` (`docs/KEKA_INTEGRATION.md`). Full list with defaults: `docs/ENV_VARIABLES.md`, template: `env.example`.

## Scheduled jobs

Nothing in the repo schedules the cron endpoint. Add a system cron on the host (hourly):

```
0 * * * * curl -s -X POST -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/meetings > /dev/null
```

It generates upcoming recurring meetings, sends 24 h / 1 h reminders, and form reminders.

## TLS / Nginx

`deploy/nginx-ssl.conf` (80 → 301 → 443, proxy to `127.0.0.1:3000`, `client_max_body_size 50M`, long proxy timeouts for recording uploads). First-time setup and certificate steps: `deploy/SSL-SETUP.md` / `bash deploy/setup-ssl-on-server.sh`. The hostname is hardcoded in those files — edit it when deploying to a new domain.

## Operations

```bash
pm2 status                 # process "oneonone"
pm2 logs oneonone --lines 200
pm2 restart oneonone       # after editing .env
curl -s https://<host>/api/health   # {"status":"healthy"}
```

Backups: use managed Postgres snapshots (RDS) or `pg_dump` on a schedule. The in-app Admin → Backup export is a partial JSON dump (users, departments, meetings, todos, recording text) and is not a substitute. S3 recordings are not covered by either — enable bucket versioning.

Nightly `pg_dump` on the app server (keeps 14 days in `/var/backups/oneonone`; `pg_dump` must be the same major version as the database). Run the command once by hand first (without the schedule part), then add it with `crontab -e` (in crontab every `%` must be written `\%`):

```bash
SHELL=/bin/bash
15 21 * * * cd /var/www/oneonone && set -a && . ./.env && set +a && mkdir -p /var/backups/oneonone && pg_dump "$(echo "$DATABASE_URL" | sed 's/?.*//')" -Fc -f /var/backups/oneonone/db-$(date +\%F).dump && find /var/backups/oneonone -name 'db-*.dump' -mtime +14 -delete
```

Restore a dump: `pg_restore --clean --if-exists -d "<database url without ?schema=…>" /var/backups/oneonone/db-YYYY-MM-DD.dump`.

Data retention runs in the hourly cron (`lib/retention.ts`): read notifications > 90 days, unread > 180 days, audit logs > 2 years, finished recording-job runs > 180 days, expired sessions. Meetings, recordings, form history and todos are never deleted.

## Rollback

```bash
cd /var/www/oneonone
git log --oneline -5                 # pick the previous good commit
git checkout <sha> -- . && npm ci && npx prisma generate && npm run build
pm2 restart oneonone
```

Migrations are forward-only; if a release included a migration, restore the DB from a snapshot taken before deploying rather than editing `_prisma_migrations` by hand.
