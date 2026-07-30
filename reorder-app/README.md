# Re-order Request App

Mobile-friendly form for **pink tag** QR scans. Looks up items in Supabase by SKU (`part_number`), pre-fills the form, and saves submissions to `reorder_requests`.

## Local dev

```bash
cd reorder-app
cp .env.example .env   # add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Open `http://localhost:5176/r/YOUR-SKU` or `http://localhost:5176/?sku=YOUR-SKU`.

## Supabase setup

Run `supabase/add-reorder-requests.sql` in the SQL Editor (creates `reorder_requests` table + RLS).

## Pink tag URL format

When hosted at `https://your-app.ondigitalocean.app`:

```
https://your-app.ondigitalocean.app/r/{SKU}
```

Example: `https://your-app.ondigitalocean.app/r/ABC-12345`

Also supported: `?sku=ABC-12345`

## Deploy

This app is the **only** static site on DigitalOcean App Platform. The main web app and scanner apps remain in the repo but are not deployed until you re-enable them in `deployments/digitalocean/digitalocean-app-spec.template.yaml`.

```bash
npm run deploy:do
```
