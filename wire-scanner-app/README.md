# Wire Box Scanner

Mobile-friendly app for scanning QR codes on wire boxes (e.g. `bx-1234`), recording check-in/check-out, job name, and footage. Data syncs to the same Supabase project as **Wire Tracker**.

## URLs (DigitalOcean)

- **Scanner (this app):** `https://your-app.ondigitalocean.app/wire-scanner/`
- **Wire Tracker (desktop):** `https://your-app.ondigitalocean.app/wire/`

**QR code URL shape** (replace host and box ID):

`https://your-app.ondigitalocean.app/wire-scanner/?box=bx-1234`

## Local development

```bash
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Runs at **http://localhost:5175**. Use `npm run dev:phone` to expose on your LAN for phone testing.

## Database

Run `supabase/add-wire-box-scans.sql` in the Supabase SQL Editor. Also run `add-wire-box-check-type.sql` and `add-wire-box-type-label-default.sql` as needed.

## Build

```bash
npm run build
```

Output is in `dist/`. Production base path is `/wire-scanner/`.
