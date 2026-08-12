# Prompt Library

A focused multi-user library for reusable AI prompts.

The application is publicly accessible. Each user's prompts remain private by default through Supabase Row Level Security.

Current version: `0.1.0`

## Features

- Create, edit, duplicate, and delete prompts.
- Save immutable prompt versions.
- Compare any two versions line by line.
- Search by prompt name or tag.
- Import and export JSON backups.
- Autosave locally in the browser.
- Email/password accounts with username profiles and Email OTP recovery.
- Per-user cloud data isolation through Supabase Row Level Security.

## Development

```bash
npm install
npm run build
```

The production static bundle is generated in `dist/client`.

## Deployment

The project is configured for Vercel using `vercel.json`.

## Database

Apply the SQL migrations in `supabase/migrations` to a Supabase project in filename order.
