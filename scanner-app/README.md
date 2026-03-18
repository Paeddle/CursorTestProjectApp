# PO Package Scanner

Standalone web app for checking in packages: scan barcodes and add documents (packing slips, paperwork) to a PO. Data is sent to the same Supabase project used by the Order Tracker **PO Info** tab.

**Dev note:** After making code changes, restart the app (`npm run dev` or `npm run dev:phone`) to pick them up. For Netlify redeploys, see **NETLIFY_DEPLOY.md**.

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
2. In the terminal you’ll see something like:
   ```
   ➜  Local:   http://localhost:5174/
   ➜  Network: http://192.168.1.xxx:5174/
   ```
3. On your phone (connected to the **same Wi‑Fi**), open the **Network** URL in the browser (e.g. `http://192.168.1.xxx:5174`).
4. Use the scanner: enter PO, scan barcodes or add documents. Camera works best on the phone.

### Option B: Public URL (use anywhere)

Deploy the scanner so you can open it from any network (e.g. at the warehouse).

1. **Build:** `npm run build` (output in `dist/`).
2. **Deploy** the `dist/` folder to [Vercel](https://vercel.com), [Netlify](https://netlify.com), or similar:
   - **Vercel:** Drag the `dist` folder onto [vercel.com/new](https://vercel.com/new), or connect your repo and set **Root Directory** to `scanner-app`, **Build command** to `npm run build`, **Output directory** to `dist`. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Project Settings.
   - **Netlify:** Connect repo, set **Base directory** to `scanner-app`, **Build command** `npm run build`, **Publish directory** `dist`. Add the same env vars in Site settings → Environment variables.
3. After deploy you’ll get a URL like `https://your-scanner.vercel.app`. Open it on your phone (or any device) to use the scanner.

## Usage

1. Enter the **current PO number** (e.g. `PO-12345`).
2. **Barcode**
   - Type a barcode and click **Add barcode**, or
   - Click **Scan with camera** to use the device camera (grant permission when prompted).
3. **Document**
   - Choose type: Packing slip / Paperwork / Other.
   - Click **Choose file or capture** to pick an image or PDF, or use the device camera on mobile.

Each barcode and document is stored in Supabase under the current PO and appears in the Order Tracker **PO Info** tab after you refresh.

## Build

```bash
npm run build
```

Output is in `dist/`. Deploy that folder to any static host (e.g. Vercel, Netlify, or the same domain as the Order Tracker on a path like `/scanner`).

## Tech

- Vite + React + TypeScript
- Supabase (client): `po_barcodes` table and Storage bucket `po-documents`
- [html5-qrcode](https://github.com/mebjas/html5-qrcode) for camera barcode scanning
