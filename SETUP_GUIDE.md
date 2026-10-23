# Setup Guide - Step by Step

Follow these steps to get your AMI One-on-One system up and running.

## Step 1: Database Setup ✅ (Choose one option)

### Option A: Local PostgreSQL (for development)

1. **Install PostgreSQL** (if not already installed):
   - macOS: `brew install postgresql@14`
   - Or download from: https://www.postgresql.org/download/

2. **Start PostgreSQL**:
   ```bash
   brew services start postgresql@14
   ```

3. **Create database**:
   ```bash
   createdb ami_one_on_one
   ```

4. **Update .env file**:
   ```
   DATABASE_URL="postgresql://your_username@localhost:5432/ami_one_on_one?schema=public"
   ```
   (Replace `your_username` with your macOS username)

### Option B: Cloud Database (Supabase - Free tier)

1. Go to https://supabase.com
2. Sign up for free account
3. Create a new project
4. Go to Settings → Database
5. Copy the connection string
6. Update `.env` with the connection string

### Option C: AWS RDS (for production)

1. Go to AWS Console → RDS
2. Create PostgreSQL database
3. Note the endpoint
4. Update `.env` with connection string

---

## Step 2: Run Database Migrations

After setting up your database, run:

```bash
npx prisma generate
npx prisma migrate dev      # applies prisma/migrations (creates all tables on a fresh DB)
npm run db:seed             # optional: demo data — WIPES the database first
```

If the database was created earlier with `prisma db push`, run `npx prisma migrate resolve --applied 0_init` once, then `migrate dev`.

Local login without Google credentials: `POST /api/auth/test-login` with `{"role":"SUPER_ADMIN"}` (see `docs/DEVELOPER_GUIDE.md`).

---

## Step 3: Google OAuth Setup

### 3.1 Create Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Click "Create Project"
3. Name it "AMI One-on-One" (or any name)
4. Click "Create"

### 3.2 Create OAuth Credentials (no extra API needed for sign-in)

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure OAuth consent screen:
   - User Type: Internal (for Google Workspace) or External
   - App name: "AMI One-on-One"
   - User support email: your email
   - Developer contact: your email
   - Click "Save and Continue"
   - Scopes: Just click "Save and Continue"
   - Test users: Add your email, click "Save and Continue"
   - Click "Back to Dashboard"

4. Create OAuth Client ID:
   - Application type: "Web application"
   - Name: "AMI One-on-One Web Client"
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - (For production, add your production URL)
   - Click "Create"
   - **Copy the Client ID and Client Secret**

5. **Update .env or .env.local** (use `.env.local` for local dev so Next.js loads it):
   ```
   GOOGLE_CLIENT_ID="paste-your-client-id-here"
   GOOGLE_CLIENT_SECRET="paste-your-client-secret-here"
   GOOGLE_WORKSPACE_DOMAIN="yourcompany.com"
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"
   ```
   (Replace `yourcompany.com` with your actual company domain. For production, set `NEXTAUTH_URL` to your app URL, e.g. `https://oneonone.yourcompany.com`.)

   **Important:** The **Authorized redirect URI** in Google Console must exactly match `{NEXTAUTH_URL}/api/auth/callback/google` (e.g. `http://localhost:3000/api/auth/callback/google` for local dev).

**If Google login doesn’t work:**
- Ensure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set in `.env` or `.env.local` (restart the dev server after changing env).
- Ensure `NEXTAUTH_URL` matches **exactly** how users open the app (e.g. `https://oneonone.yourcompany.com` with no trailing slash). Wrong URL causes "OAuthCallback" errors.
- In Google Cloud Console → Credentials → your OAuth client, add the **exact** redirect URI: `https://your-domain.com/api/auth/callback/google` (same as `NEXTAUTH_URL` + `/api/auth/callback/google`).
- If you see "Access denied", sign in with an email whose domain matches `GOOGLE_WORKSPACE_DOMAIN`.
- On the server, check logs (e.g. `pm2 logs`) for `[NextAuth] signIn callback error` to see database or callback failures.

### 3.3 Enable Google Calendar API (for calendar integration)

1. In Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click "Enable"
4. Use the same OAuth credentials created above, or create separate ones
5. Update `.env`:
   ```
   GOOGLE_CALENDAR_CLIENT_ID="same-as-above-or-separate"
   GOOGLE_CALENDAR_CLIENT_SECRET="same-as-above-or-separate"
   ```

---

## Step 4: AWS SES Setup (Optional - for email notifications)

### 4.1 Create AWS Account (if needed)

1. Go to https://aws.amazon.com/
2. Sign up for free tier account

### 4.2 Verify Email Domain

1. Go to AWS Console → SES
2. Click "Verified identities" → "Create identity"
3. Choose "Domain" or "Email address"
4. Follow verification steps

### 4.3 Create IAM User for SES

1. Go to IAM → Users → "Create user"
2. Name: "ami-one-on-one-ses"
3. Attach policy: "AmazonSESFullAccess" (or create custom policy)
4. Create access key
5. **Copy Access Key ID and Secret Access Key**

6. **Update .env file**:
   ```
   AWS_REGION="us-east-1"
   AWS_ACCESS_KEY_ID="your-access-key"
   AWS_SECRET_ACCESS_KEY="your-secret-key"
   AWS_SES_FROM_EMAIL="noreply@yourcompany.com"
   ```

**Note**: If you're in SES sandbox mode, you can only send to verified emails. Request production access for full functionality.

---

## Step 5: Test the Setup

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Open browser**: http://localhost:3000

3. **Test login**: Try signing in with your Google Workspace account

---

## Step 6: Create First Admin User

Every new Google sign-in is created as `EMPLOYEE`. To bootstrap admins, list their emails in `.env` **before** they sign in (or before their next sign-in — promotion happens on every login and never demotes):

```
INITIAL_ADMIN_EMAILS="you@yourcompany.com,ops@yourcompany.com"
```

Restart the dev server after changing `.env`. Once one SUPER_ADMIN exists, manage roles from **Admin → User Management** instead of the env var.

Fallback (no restart possible): `npx prisma studio`, or
```sql
UPDATE "User" SET role = 'SUPER_ADMIN' WHERE email = 'your-email@yourcompany.com';
```

---

## Troubleshooting

### Database Connection Issues
- Check if PostgreSQL is running: `brew services list`
- Verify connection string format
- Check database exists: `psql -l`

### Google OAuth Issues
- Verify redirect URI matches exactly
- Check OAuth consent screen is configured
- Ensure Google+ API is enabled
- Verify domain restriction in code matches your domain

### Email Not Working
- Check AWS SES is out of sandbox mode
- Verify email domain is verified
- Check AWS credentials are correct
- Review CloudWatch logs for errors

---

## Next Steps After Setup

1. Create departments in Admin panel
2. Add employees/users
3. Set up reporting hierarchy
4. Schedule your first meeting!

Need help? Check the main README.md or deployment docs.
