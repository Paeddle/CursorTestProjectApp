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

**Supabase:** If your project already has a `.env` or `scanner-app/.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, leave those two lines in `.env.deploy` empty — the script will use the values from your project `.env`. Otherwise paste the same URL and anon key you use on Netlify.

## 3. Run the deploy

From the **project root** (where `package.json` is), run:

```powershell
powershell -ExecutionPolicy Bypass -File deployments/digitalocean/deploy.ps1
```

The first run will create the app on DigitalOcean and link it to GitHub. When it finishes, it prints the live URL. After that, every push to `main` will auto-deploy.

- **Main app:** `https://your-app-xxxxx.ondigitalocean.app/`
- **Scanner app:** `https://your-app-xxxxx.ondigitalocean.app/scanner`

## If something fails

- **"Missing required setting 'DO_ACCESS_TOKEN'"** — Add your token to `deployments/digitalocean/.env.deploy` as in step 2.
- **"Missing VITE_SUPABASE_URL"** — Add them to `.env.deploy` or ensure your project root `.env` or `scanner-app/.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **PowerShell execution policy** — Run once (as Administrator if needed):  
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
