# Environment variables (.env)

Add these to your `.env` file. Required variables are needed for the app to run; optional ones enable specific features.

---

## Required (core app)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/dbname?schema=public` |
| `NEXTAUTH_URL` | Full URL of your app (must match where users access it) | `https://oneonone.yourcompany.com` |
| `NEXTAUTH_SECRET` | Secret for signing cookies/sessions (generate with `openssl rand -base64 32`) | long random string |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (sign-in) | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | from Google Cloud Console |

---

## Optional: Google Workspace & Calendar

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_WORKSPACE_DOMAIN` | Restrict sign-in to this email domain (e.g. `whitelabeliq.com`) | `whitelabeliq.com` |

Calendar sync uses the same Google OAuth as sign-in; no separate client needed if users sign in with Google.

---

## Optional: Email (meeting reminders, notifications)

**Option A – SMTP**

| Variable | Description | Example |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port (e.g. 587 for TLS) | `587` |
| `SMTP_USER` | SMTP username | your@email.com |
| `SMTP_PASSWORD` | SMTP password or app password | … |
| `EMAIL_FROM` | From address for outgoing email | `noreply@yourcompany.com` |

**Option B – AWS SES**

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for SES (and S3 if used) | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | IAM access key | … |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key | … |
| `AWS_SES_FROM_EMAIL` | From address for SES | `noreply@yourcompany.com` |

---

## Optional: Recording storage (S3)

Used for storing meeting recordings. Can also be set in Admin → Settings (encrypted in DB).

| Variable | Description | Example |
|----------|-------------|---------|
| `AWS_REGION` | AWS region for S3 | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | IAM access key with S3 access | … |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key | … |
| `AWS_S3_BUCKET` | S3 bucket name for recordings | `ami-one-on-one-recordings` |

---

## Optional: OpenAI (recordings – transcription & insights)

Can be set in Admin → Settings (stored encrypted). Fallback from env if not in DB:

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | `sk-...` |

(Models like `gpt-4o` / `whisper-1` are configurable in Admin → Settings.)

---

## Optional: Cron (recurring meetings & reminders)

Required if you use a cron job to generate recurring meetings and send reminders.

| Variable | Description | Example |
|----------|-------------|---------|
| `CRON_SECRET` | Secret sent in header `x-cron-secret` when calling `POST /api/cron/meetings` | random string |

---

## Encryption (API keys saved in Admin → Settings)

Secrets entered in Admin → Settings (`openaiApiKey`, `awsAccessKeyId`, `awsSecretKey`) are stored AES-256-GCM encrypted. The key is derived (HKDF-SHA256) from:

| Variable | Description |
|----------|-------------|
| `ENCRYPTION_SECRET` | **Set this in every environment.** `openssl rand -base64 32`. Dedicated to encryption, so rotating `NEXTAUTH_SECRET` (sessions) never touches stored keys. |
| `ENCRYPTION_SECRET_PREVIOUS` | Only during a rotation: the old `ENCRYPTION_SECRET`. The app can still read old values while `npm run secrets:reencrypt` rewrites them. Remove afterwards. |

If `ENCRYPTION_SECRET` is unset the app falls back to `NEXTAUTH_SECRET` and logs a warning at startup.

**Adopting `ENCRYPTION_SECRET` on an existing install (one time):**

```bash
echo "ENCRYPTION_SECRET=\"$(openssl rand -base64 32)\"" >> .env
pm2 restart oneonone --update-env          # or restart the dev server
npm run secrets:reencrypt -- --check       # shows what will change, exit 1 if anything needs rewriting
npm run secrets:reencrypt                  # rewrites legacy-format values and encrypts any plaintext access key
pm2 restart oneonone                       # clears the in-process settings cache
```

**Rotating the secret later:** set `ENCRYPTION_SECRET` to the new value and `ENCRYPTION_SECRET_PREVIOUS` to the old one, restart, run `npm run secrets:reencrypt`, then remove `ENCRYPTION_SECRET_PREVIOUS` and restart again.

If a value can no longer be decrypted (secret lost), the app logs `Cannot decrypt <field>` and falls back to the env var for that field; re-enter the key in Admin → Settings.

---

## Optional: Keka HR (leave & holidays)

Only needed if you want the app to skip leave and public holidays when finding meeting slots. See [KEKA_INTEGRATION.md](./KEKA_INTEGRATION.md).

| Variable | Description | Example |
|----------|-------------|---------|
| `KEKA_COMPANY` | Keka subdomain (e.g. `acme` for acme.keka.com) | `yourcompany` |
| `KEKA_ENVIRONMENT` | `keka` (production) or `kekademo` (sandbox) | `keka` |
| `KEKA_CLIENT_ID` | From Keka Developer Portal | … |
| `KEKA_CLIENT_SECRET` | From Keka Developer Portal | … |
| `KEKA_API_KEY` | From Keka Developer Portal | … |
| `KEKA_HOLIDAY_CALENDAR_ID_US` | UUID of US office holiday calendar in Keka | … |
| `KEKA_HOLIDAY_CALENDAR_ID_IN` | UUID of India office holiday calendar in Keka | … |

---

## Optional: Fathom (Zoom transcript webhook)

Only needed if you use Fathom to record Zoom calls and want transcripts in the app. See [FATHOM_ZOOM_SETUP.md](./FATHOM_ZOOM_SETUP.md).

| Variable | Description | Example |
|----------|-------------|---------|
| `FATHOM_WEBHOOK_SECRET` | Webhook secret from Fathom (e.g. `whsec_...`) | `whsec_...` |

---

## Optional: Test login (dev only)

| Variable | Description | Example |
|----------|-------------|---------|
| `ENABLE_TEST_LOGIN` | Set to `true` to allow test login in production (not recommended) | `true` |

---

## Minimal .env example

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/ami_one_on_one?schema=public"
NEXTAUTH_URL="https://oneonone.yourcompany.com"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."

# Optional: restrict sign-in to your domain
GOOGLE_WORKSPACE_DOMAIN=whitelabeliq.com

# Optional: email (pick SMTP or AWS SES)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=...
# SMTP_PASSWORD=...
# EMAIL_FROM=noreply@yourcompany.com

# Optional: cron for recurring meetings & reminders
# CRON_SECRET=your-cron-secret

# Optional: recordings (S3 + OpenAI can also be set in Admin → Settings)
# AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# AWS_S3_BUCKET=ami-one-on-one-recordings
# OPENAI_API_KEY=sk-...

# Optional: Keka (leave/holidays)
# KEKA_COMPANY=yourcompany
# KEKA_CLIENT_ID=...
# KEKA_CLIENT_SECRET=...
# KEKA_API_KEY=...
# KEKA_HOLIDAY_CALENDAR_ID_US=...
# KEKA_HOLIDAY_CALENDAR_ID_IN=...

# Optional: Fathom (Zoom transcripts)
# FATHOM_WEBHOOK_SECRET=whsec_...
```
