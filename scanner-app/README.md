# PO Package Scanner

Standalone web app for checking in packages: scan barcodes and add documents (packing slips, paperwork) to a PO. Data is sent to the same Supabase project used by the Order Tracker **PO Info** tab.

**Deploy:** This app is deployed with the rest of the project to **DigitalOcean**. From the repo root run `powershell -ExecutionPolicy Bypass -File deployments/digitalocean/deploy.ps1`. The scanner is live at **`/scanner`** on your DigitalOcean app URL (e.g. `https://cursor-test-project-app-xxxxx.ondigitalocean.app/scanner`).

**Dev note:** After making code changes, restart the app (`npm run dev` or `npm run dev:phone`) to pick them up. Redeploy to DigitalOcean by pushing to `main` (auto-deploy) or running the deploy script again.

## Setup

1. **Supabase**
   - In the **main project** run `supabase/schema.sql` in the Supabase SQL Editor (if you haven’t already).
   - Create a storage bucket named **`po-documents`** (Public). See `../supabase/README.md`.

2. **Env**
   - Copy `.env.example` to `.env` in this folder.
   - Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as the Order Tracker `.env`).

3. **Install and run**
   ```bash
   cd scanner-app
   npm install
   npm run dev
   ```
   App runs at **http://localhost:5174**.

## Use on your phone

### Option A: Same Wi‑Fi (quick)

1. On your computer, from the `scanner-app` folder run:
   ```bash
   npm run dev:phone
   ```
2. On your phone (same Wi‑Fi), open the **Network** URL shown in the terminal (e.g. `http://192.168.1.xxx:5174`).
3. Use the scanner: enter PO, scan barcodes or add documents. Camera works best on the phone.

### Option B: Use the live app (anywhere)

Deploy to DigitalOcean (see **Deploy** above). Then open your DigitalOcean app URL + `/scanner` on any device (e.g. `https://cursor-test-project-app-xxxxx.ondigitalocean.app/scanner`). Camera requires HTTPS, which DigitalOcean provides.

## Usage

1. Enter the **current PO number** (e.g. `PO-12345`).
2. **Barcode**
   - Type a barcode and click **Add barcode**, or
   - Click **Scan with camera** to use the device camera (grant permission when prompted).
3. **Document**
   - Choose type: Packing slip / Paperwork / Other.
   - Click **Choose file** or **Scan with camera** to pick an image/PDF or capture with the camera.

Each barcode and document is stored in Supabase under the current PO and appears in the Order Tracker **PO Info** tab after you refresh.

## Build

```bash
npm run build
```

Output is in `dist/`. The DigitalOcean deploy script builds both the main app and the scanner from this repo and serves the scanner at `/scanner`.

## Tech

- Vite + React + TypeScript
- Supabase (client): `po_barcodes` table and Storage bucket `po-documents`
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) for camera barcode scanning
