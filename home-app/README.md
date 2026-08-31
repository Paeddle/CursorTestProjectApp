# SHS Web Apps (home)

Landing page for the DigitalOcean root URL with a simple password gate.

Lists (after unlock):

- Reorder → `/reorder/`
- Wire Tracker → `/wire/`
- Wire Box Scanner → `/wire-scanner/`

Password is client-side only (shared `localStorage` key across same-origin apps). Shown on the page for now.

## Bug reports

- **Report a bug** — subtle link at the bottom of the page opens a dialog (name + comment).
- **Bug reports** — after unlock, use the link in the toolbar to view submitted reports (stored in Supabase, no email server).

One-time in Supabase SQL Editor: run `supabase/add-bug-reports.sql`.

Build needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same as other apps; DigitalOcean injects these at build time).

## Build

```bash
npm run build
```

Output is in `dist/`.
