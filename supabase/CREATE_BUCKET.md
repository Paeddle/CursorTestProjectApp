# Create the `po-documents` storage bucket

If the scanner app shows **"Bucket not found"** or upload fails:

**Easiest: run the SQL script**

1. Open **Supabase** → **SQL Editor** → **New query**.
2. Copy **all** of **`supabase/create-storage-bucket.sql`** and paste it.
3. Click **Run**.

That creates the bucket and upload/read policies. Try the scanner again.

---

**Alternative: create in the dashboard**

---

## 1. Open Storage

1. Go to **https://app.supabase.com** and open your project.
2. In the **left sidebar**, click **Storage**.

---

## 2. New bucket

1. Click **"New bucket"** (top right).
2. **Name:** type exactly  
   **`po-documents`**  
   (name must match; the app uses this).
3. **Public bucket:** turn **ON** (so document links work in the PO Info tab).
4. Click **"Create bucket"**.

---

## 3. Allow uploads (anon)

So the scanner app can upload files:

1. Click the **po-documents** bucket to open it.
2. Go to **Policies** (or the policy tab).
3. Click **"New policy"**.
4. Choose **"For full customization"** or **"Create a policy from scratch"**.
5. Use:
   - **Policy name:** `Allow anon uploads`
   - **Allowed operation:** **INSERT** (check INSERT).
   - **Target roles:** **anon** (or “authenticated and anon” if you prefer).
   - **WITH CHECK expression:** `true`
6. Save.

Optional: add another policy for **SELECT** with `true` so the bucket can be read (for public URLs you may not need it if the bucket is already public).

---

## 4. Try again

In the scanner app, choose a document (packing slip / paperwork) and click **Choose file or capture** again. The upload should succeed.
