# Prompt Library

A focused multi-user library for reusable AI prompts.

The application is publicly accessible. Each user's prompts remain private by default through Supabase Row Level Security.

Current version: `0.2.1`

## Features

- Create, edit, duplicate, and delete prompts.
- Save immutable prompt versions.
- Compare any two versions line by line.
- Search by prompt name or tag.
- Import and export JSON backups.
- Email/password accounts with username profiles and Email OTP recovery.
- Per-user cloud data isolation through Supabase Row Level Security.

## Development

```bash
cp .env.example .env.local
npm install
npm run build
```

Required public build environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_APP_URL` (optional locally; set it for production)

The production static bundle is generated in `dist/client`.

## Deployment

The project is configured for Vercel using `vercel.json`.

## Database

Run `supabase/schema.sql` once on a fresh Supabase project.
