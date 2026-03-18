# PO Check-in / Supabase Setup

This folder contains the database schema used by the **PO Info** tab to show barcode scans and documents per PO. Your **scanning web app** should push data into these tables.

## 1. Run the schema

1. Open [Supabase Dashboard](https://app.supabase.com) → your project → **SQL Editor**.
2. Copy the contents of `schema.sql` and run it. To allow the PO Info tab to delete barcodes/documents/entire POs, also run `add-delete-policies.sql`.

If you already ran an older version without the insert policies, run only the two “Allow anonymous insert” policy blocks at the end of `schema.sql`.

This creates:

- **`po_barcodes`** – one row per barcode scan: `po_number`, `barcode_value`, `scanned_at`.
- **`po_documents`** – one row per document (packing slip, paperwork): `po_number`, `file_url`, `document_type`, optional `name`, `scanned_at`.

## 2. Configure this app (Order Tracker)

In the project root, copy `env.example` to `.env` and set:

```env
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Get both from **Project Settings → API** in the Supabase dashboard.

## 3. How the scanning web app should push data

Use the same Supabase project and the **anon key** (or a service role key if the scanner runs server-side).

### Insert a barcode scan

```js
await supabase.from('po_barcodes').insert({
  po_number: 'PO-12345',       // current PO being checked in
  barcode_value: 'ABC123456',  // scanned barcode
  scanned_at: new Date().toISOString(),
});
```

### Insert a document (packing slip / paperwork)

First upload the file to **Supabase Storage**, then insert a row with the public URL:

```js
// 1. Upload file (e.g. from scanner/camera)
const { data: upload } = await supabase.storage
  .from('po-documents')
  .upload(`${poNumber}/${Date.now()}_packing_slip.pdf`, file, { upsert: false });

// 2. Get public URL (if bucket is public)
const { data: url } = supabase.storage.from('po-documents').getPublicUrl(upload.path);

// 3. Save reference in po_documents
await supabase.from('po_documents').insert({
  po_number: 'PO-12345',
  file_url: url.publicUrl,
  document_type: 'packing_slip',  // or 'paperwork', 'other'
  name: 'Packing slip 1',
  scanned_at: new Date().toISOString(),
});
```

Create a storage bucket named **`po-documents`** in the Supabase dashboard:

1. **Storage** → **New bucket** → Name: `po-documents`.
2. Set **Public bucket** to Yes (so the Order Tracker can open document links).
3. **Policies** → **New policy** → “Allow uploads for anon” (or use a template that allows `insert` and `select` for the bucket so the scanner can upload and the PO Info tab can read URLs).

## 4. Row Level Security (RLS)

The schema enables RLS and includes **read** and **insert** policies so both the Order Tracker (read) and the scanning app (insert) work with the anon key.
