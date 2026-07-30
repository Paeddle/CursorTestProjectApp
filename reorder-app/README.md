# Re-order Request App

Mobile-friendly form for **pink tag** QR scans. Looks up items in Supabase by SKU (`part_number`), pre-fills the form, and saves submissions to `reorder_requests`.

## Local dev

```bash
cd reorder-app
cp .env.example .env   # add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open `http://localhost:5176/r/YOUR-IPN` or `http://localhost:5176/?ipn=YOUR-IPN`.

## Supabase setup

Run `supabase/add-reorder-requests.sql` in the SQL Editor (creates `reorder_requests` table + RLS).

## Pink tag URL format

When hosted at `https://your-app.ondigitalocean.app`:

```
https://your-app.ondigitalocean.app/r/{IPN}
```

Example: `https://your-app.ondigitalocean.app/r/TP13BK`

Looks up `inventree_parts.ipn` in Supabase. Also supported: `?ipn=TP13BK` (and legacy `?sku=`).

## Request portal

Staff portal for tracking requests:

```
https://your-app.ondigitalocean.app/portal
```

Open requests tab: mark **Part ordered** and **Part received**. Received requests move to **Order history**.

After schema changes, run `supabase/alter-reorder-requests-inventree-columns.sql` in Supabase SQL Editor.

## Deploy

This app is the **only** static site on DigitalOcean App Platform. The main web app and scanner apps remain in the repo but are not deployed until you re-enable them in `deployments/digitalocean/digitalocean-app-spec.template.yaml`.

```bash
npm run deploy:do
```
