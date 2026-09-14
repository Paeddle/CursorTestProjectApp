# Parts Scanner

Mobile-friendly app for scanning part barcodes (phone camera or Bluetooth scanner) and recording check-ins. Data syncs to the same Supabase project as **Parts Tracker**.

- **Scanner (this app):** `https://your-app.ondigitalocean.app/parts-scanner/`
- **Parts Tracker (desktop):** `https://your-app.ondigitalocean.app/parts/`

Run `supabase/add-parts-tracker.sql` in the Supabase SQL Editor.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Runs at **http://localhost:5180**. Use `npm run dev:phone` so a phone on the same network can open the camera scanner.

## Build

Output is in `dist/`. Production base path is `/parts-scanner/`.
