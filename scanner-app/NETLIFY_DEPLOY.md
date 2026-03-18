# Redeploying the scanner app on Netlify

Use this after every code change to get the update live on your Netlify URL.

---

## If you use **Netlify Drop** (drag-and-drop, no Git)

1. **Build the app** (from the project root or from `scanner-app`):
   ```bash
   cd scanner-app
   npm run build
   ```
2. Open **https://app.netlify.com/drop** in your browser.
3. Drag the **`scanner-app/dist`** folder onto the page (the whole `dist` folder, not its contents).
4. Netlify will replace your site with the new build. Your site URL stays the same.

**Tip:** Keep a File Explorer window open at `scanner-app/dist` so you can drag it whenever you run `npm run build`.

---

## If your site is **connected to a Git repo** (GitHub, GitLab, etc.)

Netlify can redeploy automatically on every push.

1. **Make sure build settings are correct** (Netlify → Site → Site configuration → Build & deploy → Build settings):
   - **Base directory:** `scanner-app`
   - **Build command:** `npm run build`
   - **Publish directory:** `scanner-app/dist` (or `dist` if “Base directory” is already `scanner-app`)

2. **Environment variables** (Site configuration → Environment variables):
   - `VITE_SUPABASE_URL` = your Supabase project URL  
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key  

3. **Redeploy after changes:**
   - **Option A:** Commit and push to the branch Netlify watches (e.g. `main`). Netlify will build and deploy automatically.
   - **Option B:** Netlify → Deploys → **Trigger deploy** → **Deploy site** to rebuild without pushing.

---

## Quick reference (Drop)

```bash
cd scanner-app
npm run build
```

Then drag **`scanner-app/dist`** to **https://app.netlify.com/drop**.
