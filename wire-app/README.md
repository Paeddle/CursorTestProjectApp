# Wire Tracker

Desktop web app for viewing wire box scan history, managing jobs, and generating materials-used reports. Pairs with the **Wire Box Scanner** mobile app.

## URLs (DigitalOcean)

When deployed with the rest of this repo:

- **Wire Tracker (this app):** `https://your-app.ondigitalocean.app/wire/`
- **Wire Box Scanner:** `https://your-app.ondigitalocean.app/wire-scanner/`

QR codes on boxes should link to the scanner with the box ID, e.g.  
`https://your-app.ondigitalocean.app/wire-scanner/?box=bx-1234`

## Local development

```bash
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Runs at **http://localhost:5178**. Run `wire-scanner-app` on port 5175 for the scanner.

## Database

Run in Supabase SQL Editor (if not already done):

- `supabase/add-wire-box-scans.sql`
- `supabase/add-wire-box-check-type.sql`
- `supabase/add-wire-box-type-label-default.sql`

## Build

```bash
npm run build
```

Output is in `dist/`. Production base path is `/wire/`.
