# Parts Tracker

Desktop web app for viewing part check-ins and the parts catalog. Pairs with **Parts Scanner**.

## URLs (DigitalOcean)

- **Parts Tracker (this app):** `https://your-app.ondigitalocean.app/parts/`
- **Parts Scanner:** `https://your-app.ondigitalocean.app/parts-scanner/`

## Local development

```bash
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Runs at **http://localhost:5179**. Run `parts-scanner-app` on port 5180 for the scanner.

## Database

Run `supabase/add-parts-tracker.sql` in the Supabase SQL Editor.

## Build

```bash
npm run build
```

Output is in `dist/`. Production base path is `/parts/`.
