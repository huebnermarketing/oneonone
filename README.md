# AMI One-on-One Meeting Management System

A web application to manage bi-weekly one-on-one meetings following the AMI Agency Advantage system.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL (AWS RDS)
- **ORM**: Prisma
- **Authentication**: NextAuth.js with Google Workspace
- **Calendar**: Google Calendar API
- **Email**: AWS SES
- **Hosting**: AWS (EC2/ECS + RDS)

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
```

3. Set up the database:
```bash
npx prisma generate
npx prisma migrate dev     # applies prisma/migrations
npm run db:seed            # optional demo data (wipes DB)
```

4. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Documentation

- `docs/DEVELOPER_GUIDE.md` — architecture, data model, flows, conventions (start here)
- `docs/API_REFERENCE.md` — every API route with its auth rule
- `docs/REFACTOR_BACKLOG.md` — known defects, prioritized
- `SETUP_GUIDE.md` — Google OAuth / SES / first admin, step by step
- `DEPLOYMENT.md` — PM2 + Nginx on EC2, migrations, cron
- `docs/ENV_VARIABLES.md`, `docs/KEKA_INTEGRATION.md`, `docs/FATHOM_ZOOM_SETUP.md`, `docs/RECORDING_OPTIONS.md`

## Project Structure

```
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Auth-related pages
│   ├── (dashboard)/       # Protected dashboard pages
│   ├── api/               # API routes
│   └── layout.tsx
├── components/            # React components
│   ├── ui/               # Base UI components
│   ├── forms/            # Form components
│   └── layouts/          # Layout components
├── lib/                   # Utilities and helpers
│   ├── prisma.ts         # Prisma client
│   ├── auth.ts           # Auth utilities
│   └── google-calendar.ts # Calendar API
├── types/                 # next-auth session augmentation
├── prisma/
│   ├── schema.prisma     # Database schema
│   ├── migrations/       # Prisma migration history (applied with `migrate deploy`)
│   └── seed.ts           # Demo data (dev only)
├── deploy/                # Nginx/SSL/email/calendar setup for the EC2 host
└── docs/                  # Developer docs
```
