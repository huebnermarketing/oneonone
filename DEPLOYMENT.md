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
- App checked out at `/var/www/oneonone` on branch `main` (`deploy.sh` does `git pull origin main`).
- `.env` in the app root — see "Environment" below. `deploy.sh` writes a placeholder and exits if it is missing.
- Security group: inbound 80 + 443. Port 3000 must **not** be public.

## Routine deploy

```bash
ssh <host>
cd /var/www/oneonone
bash deploy.sh
```

`deploy.sh` does, in order: `git pull origin main` → `npm ci` → `prisma generate` → `prisma migrate deploy` → `next build` (3 GB heap) → verify `.next/BUILD_ID` → `pm2 delete oneonone; pm2 start ecosystem.config.cjs; pm2 save`. Any step failing aborts before PM2 is touched, so a bad build never replaces a running one.

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
| `NEXTAUTH_SECRET` | `openssl rand -base64 32`. **Also the encryption key for API keys stored in Admin → Settings** — rotating it invalidates them. |
| `NODE_ENV` | `production` (also set by `ecosystem.config.cjs`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client with Calendar API enabled (`deploy/GOOGLE-CALENDAR-SETUP.md`) |
| `GOOGLE_WORKSPACE_DOMAIN` | Restrict sign-in to one domain. Leaving it unset allows **any** Google account. |
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

## Rollback

```bash
cd /var/www/oneonone
git log --oneline -5                 # pick the previous good commit
git checkout <sha> -- . && npm ci && npx prisma generate && npm run build
pm2 restart oneonone
```

Migrations are forward-only; if a release included a migration, restore the DB from a snapshot taken before deploying rather than editing `_prisma_migrations` by hand.
