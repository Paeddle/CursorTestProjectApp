# Deploy to DigitalOcean (simplest steps)

Your repo is already set up. You only need to add your **DigitalOcean token** and run one command.

## 1. Get a DigitalOcean token (one-time)

1. Open: **https://cloud.digitalocean.com/account/api/tokens**
2. Click **Generate New Token**
3. Name it (e.g. "Deploy CursorTestProjectApp"), set scope **Write**
4. Copy the token (starts with `dop_v1_` or `pat_`)

## 2. Put the token in the deploy config

1. Open **`deployments/digitalocean/.env.deploy`** (in this project).
2. Set the first real value:
   ```text
   DO_ACCESS_TOKEN=dop_v1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   (paste your token after the `=`)

**Supabase:** If your project already has a `.env` or `scanner-app/.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, leave those two lines in `.env.deploy` empty — the script will use the values from your project `.env`. Otherwise paste your Supabase project URL and anon key. (The scanner app at `/scanner` needs these to open the barcode/document camera and save data.)

## 3. Run the deploy (local — always works)

From the **project root** (where `package.json` is), run either:

```powershell
npm run deploy:do
```

or:

```powershell
powershell -ExecutionPolicy Bypass -File deployments/digitalocean/deploy.ps1
```

The first run will create the app on DigitalOcean and link it to GitHub. When it finishes, it prints the live URL.

**Pushes alone** only deploy if DigitalOcean’s GitHub integration is connected *or* you completed **step 4** below. If autodeploy stops working, use **step 3** (this script) — it runs `doctl apps create-deployment --force-rebuild` and does not rely on webhooks.

## 4. GitHub Actions (push-to-deploy without relying on DO webhooks)

Add these **repository secrets** in GitHub → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|--------|
| `DIGITALOCEAN_ACCESS_TOKEN` | Same as `DO_ACCESS_TOKEN` in `.env.deploy` (API token with **Write**). |
| `DIGITALOCEAN_APP_ID` | Your App Platform app UUID (from the app URL on DigitalOcean, or the first line of `deployments/digitalocean/.do-app-id` on a machine that ran deploy once). |

After both secrets exist, every push to **`main`** runs `.github/workflows/deploy-digitalocean.yml` and triggers a **force rebuild** on the app. You can also run the workflow manually under **Actions → Deploy DigitalOcean → Run workflow**.

**If the workflow is red:** open the failed job log. Common fixes:

- **`DIGITALOCEAN_ACCESS_TOKEN is empty`** — Secret name must match exactly (repo **Settings → Secrets and variables → Actions**). Value = a [DigitalOcean API token](https://cloud.digitalocean.com/account/api/tokens) with **Write** scope (not read-only).
- **`DIGITALOCEAN_APP_ID is empty`** — Use only the UUID (e.g. `a1b2c3d4-...`), no quotes or extra spaces. Copy from **DigitalOcean → App → URL** or from local `deployments/digitalocean/.do-app-id`.
- **`Error: Unable to authenticate`** — Regenerate the API token and update the secret.
- **`Could not find App`** — Wrong `DIGITALOCEAN_APP_ID` for this token’s account.

- **Main app:** `https://your-app-xxxxx.ondigitalocean.app/`
- **Scanner app:** `https://your-app-xxxxx.ondigitalocean.app/scanner`

## If something fails

- **"Missing required setting 'DO_ACCESS_TOKEN'"** — Add your token to `deployments/digitalocean/.env.deploy` as in step 2.
- **"Missing VITE_SUPABASE_URL"** — Add them to `.env.deploy` or ensure your project root `.env` or `scanner-app/.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **PowerShell execution policy** — Run once (as Administrator if needed):  
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
