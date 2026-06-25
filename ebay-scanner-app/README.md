# eBay Item Scanner

Mobile web app for scanning product barcodes destined for eBay listings. Scans are saved to Supabase `ebay_scans` and appear in the main app's **eBay** tab.

## Setup

1. Run `supabase/add-ebay-scans.sql` in Supabase SQL Editor.
2. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same as main app).
3. `npm install && npm run dev` — opens on port **5175**.
4. Production path: `/ebay-scanner` on the DigitalOcean app.

## Usage

Scan or type a barcode. Each scan increments quantity for that barcode in the eBay tab. Use **Find info & add to Items** in the main app to look up product details and create an Items row.
