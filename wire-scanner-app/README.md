# Wire Box Scanner

Mobile-friendly app for scanning QR codes on wire boxes (e.g. `bx-1234`), recording check-in/check-out and footage. Data syncs to the same Supabase project as **Wire Tracker**.

**Check in** always means warehouse stock (stored as job `Inventory`). **Check out** requires a real job name. New boxes start as check-in to the warehouse.

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

Run `supabase/add-wire-box-scans.sql` in the Supabase SQL Editor. Also run `add-wire-box-check-type.sql`, `add-wire-box-type-label-default.sql`, and **`add-wire-types.sql`** (wire type catalog for the dropdown) as needed.

Wire types are managed on **Wire Tracker** (desktop), not on this scanner, so the mobile UI stays simple for technicians.

## Build

```bash
npm run build
```

Output is in `dist/`. Production base path is `/wire-scanner/`.
