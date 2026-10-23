#!/bin/bash

# AMI One-on-One Deployment Script
# Run this on your AWS server: bash deploy.sh

echo "🚀 Starting deployment..."

# Navigate to app directory
cd /var/www/oneonone || exit

# Pull latest code (exit if pull fails so we don't build old code)
echo "📥 Pulling latest code..."
git pull origin main || { echo "❌ git pull failed. Stash or discard local changes (e.g. git checkout -- package-lock.json) and try again."; exit 1; }

# Check if .env exists, if not create from template
if [ ! -f .env ]; then
  echo "📝 Creating .env file from template..."
  echo "⚠️  Please edit .env with your actual credentials!"
  cat > .env << 'EOF'
# Database
DATABASE_URL="postgresql://amiuser:YOUR_DB_PASSWORD@localhost:5432/ami_oneonone"

# NextAuth
NEXTAUTH_SECRET="generate-a-random-secret-key"
NEXTAUTH_URL="https://your-domain.com"
NODE_ENV="production"

# Google OAuth (get from Google Cloud Console)
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# OpenAI (optional - can be set in app settings)
OPENAI_API_KEY=""
EOF
  echo "❌ .env created but needs configuration. Please edit it and run deploy.sh again."
  exit 1
else
  echo "✅ .env file exists, using existing configuration"
fi

# Install dependencies from the lockfile (reproducible; never mutates package-lock.json)
echo "📦 Installing dependencies..."
npm ci || { echo "❌ npm ci failed."; exit 1; }

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Apply pending migrations (prisma/migrations). Never `db push` in production.
# ONE-TIME on a database that was previously created with `db push`:
#   npx prisma migrate resolve --applied 0_init
# then re-run this script. See DEPLOYMENT.md "Migrating from db push".
echo "🗄️ Applying database migrations..."
npx prisma migrate deploy || { echo "❌ prisma migrate deploy failed. If this DB predates migrations, run: npx prisma migrate resolve --applied 0_init"; exit 1; }

# Build the app (exit on failure)
echo "🏗️ Building app (this may take a few minutes)..."
NODE_OPTIONS="--max-old-space-size=3072" npm run build || { echo "❌ Build failed."; exit 1; }

# Ensure production build exists before starting (prevents 502 / "no production build" errors)
if [ ! -f .next/BUILD_ID ]; then
  echo "❌ Build did not produce .next/BUILD_ID. Do not start app."
  exit 1
fi
echo "✅ Production build found: .next/BUILD_ID"

# Do NOT run db seed on deploy - seed wipes real data. Use only for local/dev.

# Restart PM2 (ecosystem config sets cwd so next start finds .next in app dir)
echo "🔄 Restarting app..."
pm2 delete oneonone 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "✅ Deployment complete!"
echo "🌐 App URL: set NEXTAUTH_URL in .env (e.g. https://oneonone.wliq.ai)"
echo "📋 SSL: see deploy/SSL-SETUP.md and use deploy/nginx-ssl.conf on this server"
echo ""
