# SHS Web Apps (home)

Landing page for the DigitalOcean root URL with a simple password gate.

Lists (after unlock):

- Reorder → `/reorder/`
- Wire Tracker → `/wire/`
- Wire Box Scanner → `/wire-scanner/`

Password is client-side only (shared `localStorage` key across same-origin apps). Shown on the page for now.

## Build

```bash
npm run build
```

Output is in `dist/`.
