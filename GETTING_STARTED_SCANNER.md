# Get the PO Scanner & PO Info Up and Running

Follow these steps in order.

---

## Step 1: Run the database schema in Supabase

1. Open **https://app.supabase.com** and sign in.
2. Open your project (the one whose URL is in your `.env`).
3. In the left sidebar click **SQL Editor**.
4. Click **New query**.
5. Open the file **`supabase/schema.sql`** in this repo and copy **all** of its contents.
6. Paste into the Supabase SQL Editor and click **Run** (or press Ctrl+Enter).

You should see “Success. No rows returned.” That creates the `po_barcodes` and `po_documents` tables and their policies.

---

## Step 2: Create the storage bucket for documents

**If the scanner shows "Bucket not found", do this step.**

1. In Supabase, go to **Storage** in the left sidebar.
2. Click **New bucket**.
3. **Name:** `po-documents`
4. Turn **Public bucket** **ON** (so the Order Tracker can open document links).
5. Click **Create bucket**.
6. Click the **po-documents** bucket, then **Policies** (or “New policy”).
7. Add a policy so the scanner can upload. For example:
   - **Policy name:** Allow public uploads
   - **Allowed operation:** INSERT (and SELECT if you want to list files)
   - **Target roles:** Leave default or use “anon”
   - **Policy definition:** `true` for the condition (or use the “Allow all” template if your dashboard has it).

Save the policy. After this, the scanner app can upload files to `po-documents`.

---

## Step 3: Check your API key (if things don’t work)

Your `.env` has a Supabase anon key. If the scanner or PO Info tab can’t read/write:

1. In Supabase go to **Project Settings** (gear icon) → **API**.
2. Under **Project API keys**, copy the **anon public** key (long string).
3. In the **project root** `.env` set:
   ```env
   VITE_SUPABASE_ANON_KEY=<paste anon key here>
   ```
4. In **`scanner-app/.env`** set the same:
   ```env
   VITE_SUPABASE_ANON_KEY=<paste anon key here>
   ```
5. Restart both apps (Order Tracker and scanner).

---

## Step 4: Run the Order Tracker (PO Info tab)

From the **project root** (not inside `scanner-app`):

```bash
npm run dev
```

Open **http://localhost:5173** → click **PO Info** in the sidebar.  
You should see the PO Info page (empty until you add data from the scanner).

---

## Step 5: Run the scanner app

Open a **second terminal**, then:

```bash
cd scanner-app
npm install
npm run dev
```

Open **http://localhost:5174**.

- Enter a PO number (e.g. `PO-12345`).
- Add a barcode (type one and click **Add barcode**).
- Optionally add a document (choose type, then **Choose file or capture**).

Then go back to the Order Tracker → **PO Info** tab → click **Refresh**. You should see that PO with the barcode and document.

---

## Quick reference

| App              | URL                  | Command (from project root)     |
|------------------|----------------------|----------------------------------|
| Order Tracker    | http://localhost:5173 | `npm run dev`                    |
| Scanner          | http://localhost:5174 | `cd scanner-app && npm run dev` |

Both use the same Supabase project and the same `.env` Supabase values (root for Order Tracker, `scanner-app/.env` for the scanner).

---

## Deploy to DigitalOcean (main app + scanner)

The whole project (Order Tracker and scanner) is deployed to **DigitalOcean App Platform**.

1. **One-time:** Get a DigitalOcean token from https://cloud.digitalocean.com/account/api/tokens (Write scope).
2. **One-time:** Create `deployments/digitalocean/.env.deploy` and set `DO_ACCESS_TOKEN=<your-token>`. Put your GitHub repo as `DO_GITHUB_REPO=Paeddle/CursorTestProjectApp`. Leave `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` empty if your project root `.env` already has them — the script will use those.
3. From the **project root** run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deployments/digitalocean/deploy.ps1
   ```
4. When it finishes, your app is live at the URL shown (e.g. `https://cursor-test-project-app-xxxxx.ondigitalocean.app`). Order Tracker at `/`, scanner at `/scanner`. Pushing to `main` triggers an automatic redeploy.
