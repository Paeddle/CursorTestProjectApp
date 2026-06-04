# Wire Box Scanner

Scans QR codes on wire boxes (e.g. `bx-1234`), then records **job name** and **current footage** into Supabase.

**URL auto-fill:** Put a QR code on each box that links to the app with the box ID in the URL. When someone scans it, the app opens with the box ID pre-filled. Use this URL shape (replace with your app URL and box ID):

`https://your-app.ondigitalocean.app/wire-scanner/?box=bx-1234`

Example for this project: `https://cursor-test-project-app-4w9pp.ondigitalocean.app/wire-scanner/?box=bx-1234`

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

The scanner is built into the main web app at **/wire-scanner** (source lives in `src/modules/wire/scanner/`). The `wire-scanner-app/` folder is kept for reference only. Open it from **Wire Tracker** in the sidebar, or use a direct link with `?box=bx-1234`.
