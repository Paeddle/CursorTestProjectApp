# Wire Box Scanner

Scans QR codes on wire boxes (e.g. `bx-1234`), then records **job name** and **current footage** into Supabase.

- **Same Supabase project** as the main Order Tracker and PO scanner.
- Run `supabase/add-wire-box-scans.sql` in the Supabase SQL Editor to create the `wire_box_scans` table.

## Local

```bash
cp .env.example .env
# Edit .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

## Deploy (DigitalOcean)

The app is deployed as part of the same DigitalOcean app at **/wire-scanner**. Push to the `main` branch; the app spec builds `wire-scanner-app` and serves it at that path. Uses the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as the other apps.
